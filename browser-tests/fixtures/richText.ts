// Test page: TinyMCE configured like Joplin's rich text editor
// (packages/app-desktop/gui/NoteEditor/NoteBody/TinyMCE/TinyMCE.tsx), showing
// the plugin's rendering with the webview script loaded into the editor.
import type { Editor, TinyMCE } from "tinymce";
import {
  fakePlugin,
  joplinCheckboxes,
  joplinListCss,
  joplinRichTextCss,
  pluginCss,
  renderWithPlugin,
  webviewScriptUrl,
} from "./joplin.ts";

declare global {
  interface Window {
    tinymce: TinyMCE;
    mountRichText(markdown: string, hidden?: string[]): Promise<void>;
    editorDocument: Document;
    // Joplin's reasons to save (and so rewrite) the note.
    saveTriggers: string[];
    // What Joplin's own copy handler put on the clipboard.
    joplinCopies: string[];
    // What the webview script put into copy events.
    copiedText: string[];
    pluginMessages: unknown[];
  }
}

window.saveTriggers = [];
window.joplinCopies = [];
window.copiedText = [];

const changeCommands = [
  "mceBlockQuote",
  "ToggleJoplinChecklistItem",
  "Bold",
  "Italic",
  "Underline",
  "Paragraph",
  "mceApplyTextcolor",
];

// The events Joplin's rich text editor saves the note on (onChangeHandler).
function recordSaveTriggers(editor: Editor) {
  const save = (why: string) => window.saveTriggers.push(why);
  editor.on("keypress", () => save("keypress"));
  editor.on("keyup", (event) => {
    if (["Backspace", "Delete", "Enter", "Tab"].includes(event.key))
      save("keyup " + event.key);
  });
  for (const name of [
    "paste",
    "cut",
    "compositionend",
    "undo",
    "redo",
    "FormatApply",
    "FormatRemove",
    "TableModified",
    "ObjectResized",
    "drop",
  ]) {
    editor.on(name, () => save(name));
  }
  editor.on("ExecCommand", (event) => {
    const command: string = event.command || "";
    if (
      changeCommands.includes(command) ||
      /^(Insert|Header|mceToggle|mceInsert|mceTable)/.test(command)
    ) {
      save("ExecCommand " + command);
    }
  });
  editor.on("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (
      target &&
      target.nodeName === "INPUT" &&
      target.getAttribute("type") === "checkbox"
    ) {
      save("checkbox click");
    }
  });
  // Joplin copies the editor's selection itself.
  editor.on("copy", (event) => {
    const content = editor.selection.getContent();
    if (!content) return;
    window.joplinCopies.push(
      content
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    );
    event.preventDefault();
  });
}

window.mountRichText = function (markdown, hidden = []) {
  const stored: Record<string, boolean> = {};
  for (const listId of hidden) stored[listId] = true;
  const plugin = fakePlugin(stored);
  window.pluginMessages = plugin.messages;
  const html = joplinCheckboxes(renderWithPlugin(markdown), "richText");

  return new Promise((resolve) => {
    void window.tinymce.init({
      selector: "#editor",
      license_key: "gpl",
      height: 800,
      menubar: false,
      toolbar: false,
      statusbar: false,
      promotion: false,
      branding: false,
      body_class: "jop-tinymce",
      highlight_on_focus: false,
      noneditable_class: "joplin-editable",
      valid_elements: "#p,*[*]",
      content_style: joplinListCss + joplinRichTextCss + pluginCss(),
      setup(editor) {
        recordSaveTriggers(editor);
        editor.on("init", () => {
          editor.setContent(html);
          const doc = editor.getDoc();
          const win = editor.getWin() as Window &
            typeof globalThis & {
              webviewApi?: unknown;
            };
          window.editorDocument = doc;
          win.webviewApi = { postMessage: plugin.postMessage };
          // Like in Joplin, the async Clipboard API is unavailable here.
          Object.defineProperty(win.navigator, "clipboard", {
            value: undefined,
          });
          const setData = win.DataTransfer.prototype.setData;
          win.DataTransfer.prototype.setData = function (
            type: string,
            data: string,
          ) {
            if (type === "text/plain") window.copiedText.push(data);
            return setData.call(this, type, data);
          };
          const script = doc.createElement("script");
          script.src = webviewScriptUrl();
          script.onload = () => setTimeout(resolve, 100);
          doc.head.appendChild(script);
        });
      },
    });
  });
};
