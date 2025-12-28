import type * as Monaco from "monaco-editor";

let isRegistered = false;

/**
 * Register the custom "note" language for Scribblr.
 * This language highlights dates, times, URLs, and checkboxes.
 */
export function registerNoteLanguage(monaco: typeof Monaco): void {
  if (isRegistered) {
    return;
  }
  isRegistered = true;

  // Register the language
  monaco.languages.register({ id: "note" });

  // Define the tokenizer rules
  monaco.languages.setMonarchTokensProvider("note", {
    tokenizer: {
      root: [
        // Checked checkbox - must come before unchecked
        [/\[[xX]\]/, "checkbox.checked"],

        // Unchecked checkbox
        [/\[ \]/, "checkbox.unchecked"],

        // URLs (https:// or http://)
        [/https?:\/\/[^\s]+/, "url"],

        // Dates: YYYY/MM/DD or YYYY-MM-DD
        [/\d{4}[/-]\d{2}[/-]\d{2}/, "date"],

        // Times: HH:MM, HH:MM:SS, with optional AM/PM
        [/\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?/, "time"],
      ],
    },
  });

  // Define theme rules for light theme (vs)
  monaco.editor.defineTheme("note-light", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "date", foreground: "2563eb" }, // blue-600
      { token: "time", foreground: "0891b2" }, // cyan-600
      { token: "url", foreground: "7c3aed", fontStyle: "underline" }, // violet-600
      { token: "checkbox.unchecked", foreground: "6b7280" }, // gray-500
      { token: "checkbox.checked", foreground: "16a34a" }, // green-600
    ],
    colors: {},
  });

  // Define theme rules for dark theme (vs-dark)
  monaco.editor.defineTheme("note-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "date", foreground: "60a5fa" }, // blue-400
      { token: "time", foreground: "22d3ee" }, // cyan-400
      { token: "url", foreground: "a78bfa", fontStyle: "underline" }, // violet-400
      { token: "checkbox.unchecked", foreground: "9ca3af" }, // gray-400
      { token: "checkbox.checked", foreground: "4ade80" }, // green-400
    ],
    colors: {},
  });
}

/**
 * Get the appropriate theme name for the note language based on dark mode.
 */
export function getNoteTheme(darkMode: boolean): string {
  return darkMode ? "note-dark" : "note-light";
}
