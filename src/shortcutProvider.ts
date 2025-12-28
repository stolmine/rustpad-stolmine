import type * as Monaco from "monaco-editor";
import { shortcuts } from "./shortcuts";

let isRegistered = false;

export function registerShortcutProvider(monaco: typeof Monaco): void {
  if (isRegistered) {
    return;
  }
  isRegistered = true;

  monaco.languages.registerCompletionItemProvider("*", {
    triggerCharacters: ["@"],

    provideCompletionItems(model, position) {
      const textUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const match = textUntilPosition.match(/@(\w*)$/);
      if (!match) {
        return { suggestions: [] };
      }

      const prefix = match[1].toLowerCase();
      const startColumn = position.column - match[0].length;

      const suggestions: Monaco.languages.CompletionItem[] = shortcuts
        .filter((s) => s.trigger.toLowerCase().includes(prefix) || prefix === "")
        .map((shortcut) => ({
          label: shortcut.trigger,
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: shortcut.description,
          documentation: `Expands to: ${shortcut.expand()}`,
          insertText: shortcut.expand(),
          range: {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: startColumn,
            endColumn: position.column,
          },
        }));

      return { suggestions };
    },
  });
}
