import debounce from "lodash.debounce";
import type {
  IDisposable,
  IPosition,
  editor,
} from "monaco-editor/esm/vs/editor/editor.api";

import { OpSeq } from "./wasm";

/** Options passed in to the Rustpad constructor. */
export type RustpadOptions = {
  readonly uri: string;
  readonly editor: editor.IStandaloneCodeEditor;
  readonly onConnected?: () => void;
  readonly onDisconnected?: () => void;
  readonly onDesynchronized?: () => void;
  readonly onChangeLanguage?: (language: string) => void;
  readonly onChangeUsers?: (users: Record<number, UserInfo>) => void;
  readonly onAuthenticatedEmail?: (email: string | null) => void;
  readonly reconnectInterval?: number;
};

/** A user currently editing the document. */
export type UserInfo = {
  readonly name: string;
  readonly hue: number;
};

/** Browser client for Rustpad. */
class Rustpad {
  private ws?: WebSocket;
  private connecting?: boolean;
  private recentFailures: number = 0;
  private readonly model: editor.ITextModel;
  private readonly onChangeHandle: IDisposable;
  private readonly onCursorHandle: IDisposable;
  private readonly onSelectionHandle: IDisposable;
  private readonly beforeUnload: (event: BeforeUnloadEvent) => void;
  private readonly tryConnectId: number;
  private readonly resetFailuresId: number;

  // Client-server state
  private me: number = -1;
  private revision: number = 0;
  private outstanding?: OpSeq;
  private buffer?: OpSeq;
  private users: Record<number, UserInfo> = {};
  private userCursors: Record<number, CursorData> = {};
  private myInfo?: UserInfo;
  private cursorData: CursorData = { cursors: [], selections: [] };

  // Intermittent local editor state
  private lastValue: string = "";
  private ignoreChanges: boolean = false;
  private oldDecorations: string[] = [];

  // Line ownership tracking - maps line number to owner email (or session ID for anonymous)
  private lineOwnership: Map<number, { owner: string; hue: number }> = new Map();
  private oldLineDecorations: string[] = [];
  // Current user's email (for persistent ownership)
  private myEmail: string | null = null;
  // Email -> hue color preferences (from server)
  private emailColors: Map<string, number> = new Map();
  // Fixed color assignments (overrides dynamic colors when set)
  private fixedColors: Map<string, number> = new Map();
  private useFixedColors: boolean = false;

  constructor(readonly options: RustpadOptions) {
    this.model = options.editor.getModel()!;
    this.onChangeHandle = options.editor.onDidChangeModelContent((e) =>
      this.onChange(e),
    );
    const cursorUpdate = debounce(() => this.sendCursorData(), 20);
    this.onCursorHandle = options.editor.onDidChangeCursorPosition((e) => {
      this.onCursor(e);
      cursorUpdate();
    });
    this.onSelectionHandle = options.editor.onDidChangeCursorSelection((e) => {
      this.onSelection(e);
      cursorUpdate();
    });
    this.beforeUnload = (event: BeforeUnloadEvent) => {
      if (this.outstanding) {
        event.preventDefault();
        event.returnValue = "";
      } else {
        delete event.returnValue;
      }
    };
    window.addEventListener("beforeunload", this.beforeUnload);

    const interval = options.reconnectInterval ?? 1000;
    this.tryConnect();
    this.tryConnectId = window.setInterval(() => this.tryConnect(), interval);
    this.resetFailuresId = window.setInterval(
      () => (this.recentFailures = 0),
      15 * interval,
    );
  }

  /** Destroy this Rustpad instance and close any sockets. */
  dispose() {
    window.clearInterval(this.tryConnectId);
    window.clearInterval(this.resetFailuresId);
    this.onSelectionHandle.dispose();
    this.onCursorHandle.dispose();
    this.onChangeHandle.dispose();
    window.removeEventListener("beforeunload", this.beforeUnload);
    this.ws?.close();
  }

  /** Try to set the language of the editor, if connected. */
  setLanguage(language: string): boolean {
    this.ws?.send(`{"SetLanguage":${JSON.stringify(language)}}`);
    return this.ws !== undefined;
  }

  /** Set fixed color mode and color assignments. */
  setFixedColors(enabled: boolean, colors: Record<string, number>) {
    this.useFixedColors = enabled;
    this.fixedColors.clear();
    for (const [email, hue] of Object.entries(colors)) {
      this.fixedColors.set(email, hue);
    }
    // Refresh all line decorations with new color mode
    this.refreshAllLineColors();
  }

  /** Get the effective hue for an email (respects fixed colors mode). */
  private getHueForEmail(email: string): number {
    if (this.useFixedColors && this.fixedColors.has(email)) {
      return this.fixedColors.get(email)!;
    }
    return this.emailColors.get(email) ?? generateHueFromEmail(email);
  }

  /** Refresh all line colors based on current color mode. */
  private refreshAllLineColors() {
    let changed = false;
    for (const [line, lineOwner] of this.lineOwnership) {
      // Only refresh email-based ownership (not session-based)
      if (!lineOwner.owner.startsWith("session:")) {
        const newHue = this.getHueForEmail(lineOwner.owner);
        if (lineOwner.hue !== newHue) {
          this.lineOwnership.set(line, { owner: lineOwner.owner, hue: newHue });
          changed = true;
        }
      }
    }
    if (changed) {
      this.updateLineDecorations();
    }
  }

  /** Set the user's information. */
  setInfo(info: UserInfo) {
    const hueChanged = this.myInfo && this.myInfo.hue !== info.hue;
    this.myInfo = info;
    this.sendInfo();

    // If hue changed, update colors
    if (hueChanged) {
      if (this.myEmail) {
        // Authenticated user: send color to server for persistence
        this.sendColor(info.hue);
      } else {
        // Anonymous user: just update local line colors
        const myOwner = `session:${this.me}`;
        this.updateOwnerHue(myOwner, info.hue);
      }
    }
  }

  /** Send color preference to server (for authenticated users). */
  private sendColor(hue: number) {
    console.log("[Rustpad] sendColor:", { hue, myEmail: this.myEmail, lineCount: this.lineOwnership.size });
    if (this.myEmail) {
      // Update local cache immediately for responsiveness
      this.emailColors.set(this.myEmail, hue);
      console.log("[Rustpad] Calling updateOwnerHue for:", this.myEmail);
      this.updateOwnerHue(this.myEmail, hue);
    }
    this.ws?.send(`{"SetColor":${hue}}`);
  }

  /** Update the hue for all lines owned by a specific owner. */
  private updateOwnerHue(ownerKey: string, newHue: number) {
    let changed = false;
    let matchCount = 0;
    console.log("[Rustpad] updateOwnerHue:", { ownerKey, newHue, totalLines: this.lineOwnership.size });
    for (const [line, lineOwner] of this.lineOwnership) {
      console.log("[Rustpad] Line", line, "owner:", lineOwner.owner, "vs", ownerKey, "match:", lineOwner.owner === ownerKey);
      if (lineOwner.owner === ownerKey && lineOwner.hue !== newHue) {
        this.lineOwnership.set(line, { owner: ownerKey, hue: newHue });
        changed = true;
        matchCount++;
      }
    }
    console.log("[Rustpad] updateOwnerHue result:", { changed, matchCount });
    if (changed) {
      this.updateLineDecorations();
    }
  }

  /**
   * Attempts a WebSocket connection.
   *
   * Safety Invariant: Until this WebSocket connection is closed, no other
   * connections will be attempted because either `this.ws` or
   * `this.connecting` will be set to a truthy value.
   *
   * Liveness Invariant: After this WebSocket connection closes, either through
   * error or successful end, both `this.connecting` and `this.ws` will be set
   * to falsy values.
   */
  private tryConnect() {
    if (this.connecting || this.ws) return;
    this.connecting = true;
    const ws = new WebSocket(this.options.uri);
    ws.onopen = () => {
      this.connecting = false;
      this.ws = ws;
      this.options.onConnected?.();
      this.users = {};
      this.options.onChangeUsers?.(this.users);
      this.sendInfo();
      this.sendCursorData();
      if (this.outstanding) {
        this.sendOperation(this.outstanding);
      }
    };
    ws.onclose = () => {
      if (this.ws) {
        this.ws = undefined;
        this.options.onDisconnected?.();
        if (++this.recentFailures >= 5) {
          // If we disconnect 5 times within 15 reconnection intervals, then the
          // client is likely desynchronized and needs to refresh.
          this.dispose();
          this.options.onDesynchronized?.();
        }
      } else {
        this.connecting = false;
      }
    };
    ws.onmessage = ({ data }) => {
      if (typeof data === "string") {
        this.handleMessage(JSON.parse(data));
      }
    };
  }

  private handleMessage(msg: ServerMsg) {
    if (msg.Identity !== undefined) {
      this.me = msg.Identity;
    } else if (msg.AuthenticatedEmail !== undefined) {
      this.myEmail = msg.AuthenticatedEmail;
      this.options.onAuthenticatedEmail?.(msg.AuthenticatedEmail);
    } else if (msg.History !== undefined) {
      const { start, operations } = msg.History;
      if (start > this.revision) {
        console.warn("History message has start greater than last operation.");
        this.ws?.close();
        return;
      }
      for (let i = this.revision - start; i < operations.length; i++) {
        let { id, operation, email } = operations[i];
        this.revision++;
        if (id === this.me) {
          this.serverAck();
        } else {
          operation = OpSeq.from_str(JSON.stringify(operation));
          this.applyServer(operation, id, email);
        }
      }
    } else if (msg.Language !== undefined) {
      this.options.onChangeLanguage?.(msg.Language);
    } else if (msg.UserInfo !== undefined) {
      const { id, info } = msg.UserInfo;
      if (id !== this.me) {
        const oldInfo = this.users[id];
        this.users = { ...this.users };
        if (info) {
          this.users[id] = info;
          // Update line ownership colors for session-based lines (anonymous users)
          // Lines tracked by email use email-derived colors and don't need updating
          const expectedHue = oldInfo?.hue ?? generateHueFromId(id);
          if (expectedHue !== info.hue) {
            this.updateOwnerHue(`session:${id}`, info.hue);
          }
        } else {
          delete this.users[id];
          delete this.userCursors[id];
        }
        this.updateCursors();
        this.options.onChangeUsers?.(this.users);
      }
    } else if (msg.UserCursor !== undefined) {
      const { id, data } = msg.UserCursor;
      if (id !== this.me) {
        this.userCursors[id] = data;
        this.updateCursors();
      }
    } else if (msg.UserColor !== undefined) {
      const { email, hue } = msg.UserColor;
      const oldHue = this.emailColors.get(email);
      this.emailColors.set(email, hue);
      // Update line colors for this email if hue changed
      if (oldHue !== hue) {
        this.updateOwnerHue(email, hue);
      }
    }
  }

  private serverAck() {
    if (!this.outstanding) {
      console.warn("Received serverAck with no outstanding operation.");
      return;
    }
    this.outstanding = this.buffer;
    this.buffer = undefined;
    if (this.outstanding) {
      this.sendOperation(this.outstanding);
    }
  }

  private applyServer(operation: OpSeq, userId: number, email?: string) {
    if (this.outstanding) {
      const pair = this.outstanding.transform(operation)!;
      this.outstanding = pair.first();
      operation = pair.second();
      if (this.buffer) {
        const pair = this.buffer.transform(operation)!;
        this.buffer = pair.first();
        operation = pair.second();
      }
    }

    // Analyze operation BEFORE applying to get correct line positions
    const { affectedLines, lineShifts } = this.analyzeOperation(operation);

    this.applyOperation(operation);

    // Update line ownership - use email for persistent ownership, fall back to ID
    if (affectedLines.size > 0) {
      const owner = email ?? `session:${userId}`;
      const userHue = email
        ? this.getHueForEmail(email)
        : (this.users[userId]?.hue ?? generateHueFromId(userId));
      this.updateLineOwnership(affectedLines, owner, userHue, lineShifts);
    }
  }

  private applyClient(operation: OpSeq) {
    if (!this.outstanding) {
      this.sendOperation(operation);
      this.outstanding = operation;
    } else if (!this.buffer) {
      this.buffer = operation;
    } else {
      this.buffer = this.buffer.compose(operation);
    }
    this.transformCursors(operation);
  }

  private sendOperation(operation: OpSeq) {
    const op = operation.to_string();
    this.ws?.send(`{"Edit":{"revision":${this.revision},"operation":${op}}}`);
  }

  private sendInfo() {
    if (this.myInfo) {
      this.ws?.send(`{"ClientInfo":${JSON.stringify(this.myInfo)}}`);
    }
  }

  private sendCursorData() {
    if (!this.buffer) {
      this.ws?.send(`{"CursorData":${JSON.stringify(this.cursorData)}}`);
    }
  }

  private applyOperation(operation: OpSeq) {
    if (operation.is_noop()) return;

    this.ignoreChanges = true;
    const ops: (string | number)[] = JSON.parse(operation.to_string());
    let index = 0;

    for (const op of ops) {
      if (typeof op === "string") {
        // Insert
        const pos = unicodePosition(this.model, index);
        index += unicodeLength(op);
        this.model.pushEditOperations(
          this.options.editor.getSelections(),
          [
            {
              range: {
                startLineNumber: pos.lineNumber,
                startColumn: pos.column,
                endLineNumber: pos.lineNumber,
                endColumn: pos.column,
              },
              text: op,
              forceMoveMarkers: true,
            },
          ],
          () => null,
        );
      } else if (op >= 0) {
        // Retain
        index += op;
      } else {
        // Delete
        const chars = -op;
        var from = unicodePosition(this.model, index);
        var to = unicodePosition(this.model, index + chars);
        this.model.pushEditOperations(
          this.options.editor.getSelections(),
          [
            {
              range: {
                startLineNumber: from.lineNumber,
                startColumn: from.column,
                endLineNumber: to.lineNumber,
                endColumn: to.column,
              },
              text: "",
              forceMoveMarkers: true,
            },
          ],
          () => null,
        );
      }
    }

    this.lastValue = this.model.getValue();
    this.ignoreChanges = false;

    this.transformCursors(operation);
  }

  private transformCursors(operation: OpSeq) {
    for (const data of Object.values(this.userCursors)) {
      data.cursors = data.cursors.map((c) => operation.transform_index(c));
      data.selections = data.selections.map(([s, e]) => [
        operation.transform_index(s),
        operation.transform_index(e),
      ]);
    }
    this.updateCursors();
  }

  private updateCursors() {
    const decorations: editor.IModelDeltaDecoration[] = [];

    for (const [id, data] of Object.entries(this.userCursors)) {
      if (id in this.users) {
        const { hue, name } = this.users[id as any];
        generateCssStyles(hue);

        for (const cursor of data.cursors) {
          const position = unicodePosition(this.model, cursor);
          decorations.push({
            options: {
              className: `remote-cursor-${hue}`,
              stickiness: 1,
              zIndex: 2,
            },
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: position.lineNumber,
              endColumn: position.column,
            },
          });
        }
        for (const selection of data.selections) {
          const position = unicodePosition(this.model, selection[0]);
          const positionEnd = unicodePosition(this.model, selection[1]);
          decorations.push({
            options: {
              className: `remote-selection-${hue}`,
              hoverMessage: {
                value: name,
              },
              stickiness: 1,
              zIndex: 1,
            },
            range: {
              startLineNumber: position.lineNumber,
              startColumn: position.column,
              endLineNumber: positionEnd.lineNumber,
              endColumn: positionEnd.column,
            },
          });
        }
      }
    }

    this.oldDecorations = this.model.deltaDecorations(
      this.oldDecorations,
      decorations,
    );
  }

  /** Update line decorations based on ownership. */
  private updateLineDecorations() {
    const decorations: editor.IModelDeltaDecoration[] = [];
    const lineCount = this.model.getLineCount();

    for (const [lineNumber, owner] of this.lineOwnership) {
      // Skip if line no longer exists
      if (lineNumber < 1 || lineNumber > lineCount) continue;

      // Skip blank lines
      const lineContent = this.model.getLineContent(lineNumber);
      if (lineContent.trim().length === 0) continue;

      generateLineForegroundStyles(owner.hue);

      decorations.push({
        range: {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: lineContent.length + 1,
        },
        options: {
          inlineClassName: `line-owner-text-${owner.hue}`,
          stickiness: 1,
        },
      });
    }

    this.oldLineDecorations = this.model.deltaDecorations(
      this.oldLineDecorations,
      decorations,
    );
  }

  /**
   * Update line ownership based on affected lines.
   * Also adjusts existing ownership when lines are inserted/deleted.
   */
  private updateLineOwnership(
    affectedLines: Set<number>,
    owner: string,
    ownerHue: number,
    lineShifts: Array<{ fromLine: number; delta: number }>
  ) {
    // Apply line shifts (from insertions/deletions) to existing ownership
    // Process shifts in reverse order to avoid conflicts
    lineShifts.sort((a, b) => b.fromLine - a.fromLine);

    for (const shift of lineShifts) {
      if (shift.delta === 0) continue;

      const newOwnership = new Map<number, { owner: string; hue: number }>();
      for (const [line, lineOwner] of this.lineOwnership) {
        if (line < shift.fromLine) {
          newOwnership.set(line, lineOwner);
        } else if (shift.delta > 0) {
          // Lines inserted: shift down
          newOwnership.set(line + shift.delta, lineOwner);
        } else {
          // Lines deleted: shift up (if line still exists)
          const newLine = line + shift.delta;
          if (newLine >= shift.fromLine) {
            newOwnership.set(newLine, lineOwner);
          }
          // Lines in the deleted range are removed
        }
      }
      this.lineOwnership = newOwnership;
    }

    // Set ownership for affected lines (skip blank lines)
    for (const line of affectedLines) {
      if (line >= 1 && line <= this.model.getLineCount()) {
        const lineContent = this.model.getLineContent(line);
        if (lineContent.trim().length > 0) {
          this.lineOwnership.set(line, { owner, hue: ownerHue });
        } else {
          // Remove ownership from blank lines
          this.lineOwnership.delete(line);
        }
      }
    }

    this.updateLineDecorations();
  }

  /**
   * Analyze an operation to determine which lines are affected and any line shifts.
   * Returns affected line numbers and shift information.
   */
  private analyzeOperation(operation: OpSeq): {
    affectedLines: Set<number>;
    lineShifts: Array<{ fromLine: number; delta: number }>;
  } {
    const affectedLines = new Set<number>();
    const lineShifts: Array<{ fromLine: number; delta: number }> = [];

    const ops: (string | number)[] = JSON.parse(operation.to_string());
    let index = 0;
    const content = this.model.getValue();

    for (const op of ops) {
      if (typeof op === "string") {
        // Insert operation
        const pos = this.model.getPositionAt(this.unicodeToUtf16Offset(content, index));
        const startLine = pos.lineNumber;

        // Count newlines in inserted text
        const newlineCount = (op.match(/\n/g) || []).length;

        // Mark all affected lines (from start to start + newlines)
        for (let i = 0; i <= newlineCount; i++) {
          affectedLines.add(startLine + i);
        }

        // Record line shift if newlines were inserted
        if (newlineCount > 0) {
          lineShifts.push({ fromLine: startLine + 1, delta: newlineCount });
        }

        index += unicodeLength(op);
      } else if (op >= 0) {
        // Retain
        index += op;
      } else {
        // Delete operation
        const chars = -op;
        const fromPos = this.model.getPositionAt(this.unicodeToUtf16Offset(content, index));
        const toPos = this.model.getPositionAt(this.unicodeToUtf16Offset(content, index + chars));

        const startLine = fromPos.lineNumber;
        const endLine = toPos.lineNumber;

        // The line where deletion starts is affected
        affectedLines.add(startLine);

        // Count deleted lines
        const deletedLines = endLine - startLine;
        if (deletedLines > 0) {
          lineShifts.push({ fromLine: startLine + 1, delta: -deletedLines });
        }
      }
    }

    return { affectedLines, lineShifts };
  }

  /**
   * Convert unicode offset to UTF-16 offset for model.getPositionAt().
   */
  private unicodeToUtf16Offset(content: string, unicodeOffset: number): number {
    let utf16Offset = 0;
    let count = 0;
    for (const c of content) {
      if (count >= unicodeOffset) break;
      utf16Offset += c.length;
      count++;
    }
    return utf16Offset;
  }

  private onChange(event: editor.IModelContentChangedEvent) {
    if (!this.ignoreChanges) {
      const content = this.lastValue;
      const contentLength = unicodeLength(content);
      let offset = 0;

      // Track affected lines and line shifts for ownership
      const affectedLines = new Set<number>();
      const lineShifts: Array<{ fromLine: number; delta: number }> = [];

      let operation = OpSeq.new();
      operation.retain(contentLength);
      event.changes.sort((a, b) => b.rangeOffset - a.rangeOffset);
      for (const change of event.changes) {
        // The following dance is necessary to convert from UTF-16 indices (evil
        // encoding-dependent JavaScript representation) to portable Unicode
        // codepoint indices.
        const { text, rangeOffset, rangeLength } = change;
        const initialLength = unicodeLength(content.slice(0, rangeOffset));
        const deletedLength = unicodeLength(
          content.slice(rangeOffset, rangeOffset + rangeLength),
        );
        const restLength =
          contentLength + offset - initialLength - deletedLength;
        const changeOp = OpSeq.new();
        changeOp.retain(initialLength);
        changeOp.delete(deletedLength);
        changeOp.insert(text);
        changeOp.retain(restLength);
        operation = operation.compose(changeOp)!;
        offset += changeOp.target_len() - changeOp.base_len();

        // Track line ownership changes from this change
        // Use the range from the change event (already in line/column format)
        const startLine = change.range.startLineNumber;
        const endLine = change.range.endLineNumber;
        const deletedLines = endLine - startLine;
        const insertedNewlines = (text.match(/\n/g) || []).length;

        // Mark the start line as affected
        affectedLines.add(startLine);

        // If text was inserted with newlines, mark those new lines too
        for (let i = 1; i <= insertedNewlines; i++) {
          affectedLines.add(startLine + i);
        }

        // Track line shifts
        const lineDelta = insertedNewlines - deletedLines;
        if (lineDelta !== 0) {
          lineShifts.push({ fromLine: startLine + 1, delta: lineDelta });
        }
      }

      this.applyClient(operation);
      this.lastValue = this.model.getValue();

      // Update line ownership for current user - use email for persistence
      if (this.myInfo && affectedLines.size > 0) {
        const myOwner = this.myEmail ?? `session:${this.me}`;
        const myHue = this.myEmail
          ? this.getHueForEmail(this.myEmail)
          : this.myInfo.hue;
        console.log("[Rustpad] onChange storing lines:", { myOwner, myHue, myEmail: this.myEmail, useFixedColors: this.useFixedColors, lines: Array.from(affectedLines) });
        this.updateLineOwnership(affectedLines, myOwner, myHue, lineShifts);
      }
    }
  }

  private onCursor(event: editor.ICursorPositionChangedEvent) {
    const cursors = [event.position, ...event.secondaryPositions];
    this.cursorData.cursors = cursors.map((p) => unicodeOffset(this.model, p));
  }

  private onSelection(event: editor.ICursorSelectionChangedEvent) {
    const selections = [event.selection, ...event.secondarySelections];
    this.cursorData.selections = selections.map((s) => [
      unicodeOffset(this.model, s.getStartPosition()),
      unicodeOffset(this.model, s.getEndPosition()),
    ]);
  }
}

type UserOperation = {
  id: number;
  operation: any;
  email?: string;
};

type CursorData = {
  cursors: number[];
  selections: [number, number][];
};

type ServerMsg = {
  Identity?: number;
  AuthenticatedEmail?: string | null;
  History?: {
    start: number;
    operations: UserOperation[];
  };
  Language?: string;
  UserInfo?: {
    id: number;
    info: UserInfo | null;
  };
  UserCursor?: {
    id: number;
    data: CursorData;
  };
  UserColor?: {
    email: string;
    hue: number;
  };
};

/** Returns the number of Unicode codepoints in a string. */
function unicodeLength(str: string): number {
  let length = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const c of str) ++length;
  return length;
}

/** Returns the number of Unicode codepoints before a position in the model. */
function unicodeOffset(model: editor.ITextModel, pos: IPosition): number {
  const value = model.getValue();
  const offsetUTF16 = model.getOffsetAt(pos);
  return unicodeLength(value.slice(0, offsetUTF16));
}

/** Returns the position after a certain number of Unicode codepoints. */
function unicodePosition(model: editor.ITextModel, offset: number): IPosition {
  const value = model.getValue();
  let offsetUTF16 = 0;
  for (const c of value) {
    // Iterate over Unicode codepoints
    if (offset <= 0) break;
    offsetUTF16 += c.length;
    offset -= 1;
  }
  return model.getPositionAt(offsetUTF16);
}

/**
 * Generate a consistent hue (0-360) from an email string.
 * Uses a simple hash function to ensure the same email always produces the same color.
 */
export function generateHueFromEmail(email: string): number {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    const char = email.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Ensure positive value and map to 0-360 range
  return Math.abs(hash) % 360;
}

/** Cache for private use by `generateCssStyles()`. */
const generatedStyles = new Set<number>();

/** Add CSS styles for a remote user's cursor and selection. */
function generateCssStyles(hue: number) {
  if (!generatedStyles.has(hue)) {
    generatedStyles.add(hue);
    const css = `
      .monaco-editor .remote-selection-${hue} {
        background-color: hsla(${hue}, 90%, 80%, 0.5);
      }
      .monaco-editor .remote-cursor-${hue} {
        border-left: 2px solid hsl(${hue}, 90%, 25%);
      }
    `;
    const element = document.createElement("style");
    const text = document.createTextNode(css);
    element.appendChild(text);
    document.head.appendChild(element);
  }
}

/** Cache for private use by `generateLineForegroundStyles()`. */
const generatedLineStyles = new Set<number>();

/** Add CSS styles for line ownership foreground text coloring. */
function generateLineForegroundStyles(hue: number) {
  if (!generatedLineStyles.has(hue)) {
    generatedLineStyles.add(hue);
    // Use text foreground colors that work in both light and dark modes
    const css = `
      .monaco-editor .line-owner-text-${hue} {
        color: hsl(${hue}, 70%, 35%) !important;
      }
      .monaco-editor.vs-dark .line-owner-text-${hue},
      .monaco-editor.hc-black .line-owner-text-${hue} {
        color: hsl(${hue}, 70%, 65%) !important;
      }
    `;
    const element = document.createElement("style");
    const text = document.createTextNode(css);
    element.appendChild(text);
    document.head.appendChild(element);
  }
}

/** Generate a consistent hue from a user ID (for users without info). */
function generateHueFromId(id: number): number {
  // Use golden ratio to spread hues evenly
  return Math.floor((id * 137.508) % 360);
}

export default Rustpad;
