// Joplin's styles and markup that the plugin has to fit into, taken from
// Joplin's renderer (packages/renderer/noteStyle.ts, MdToHtml/rules/checkbox.ts,
// listTabSize from packages/lib/theme.ts).
import MarkdownIt from "markdown-it";
import createCheckboxRenderer from "../../src/checkboxRenderer.ts";
import type { PluginMessage, PluginResponse } from "../../src/messages.ts";

export const joplinListCss = `
  body { font-family: sans-serif; font-size: 16px; }
  ul, ol { padding-left: 0; margin-left: 1.7em; }
  li { margin-bottom: .4em; }
  li p { margin-top: 0.2em; margin-bottom: 0; }
  .joplin-editable .joplin-source { display: none; }
`;

// Preview: an <input> pulled back over the list's margin.
export const joplinPreviewCss = `
  li.md-checkbox { list-style-type: none; }
  li.md-checkbox input[type=checkbox] {
    margin-left: -1.71em; margin-right: 0.7em; position: relative; top: 1px;
  }
`;

// Rich text editor: an absolutely positioned li::before (a Font Awesome glyph
// in Joplin; a bordered box here, with the same box and margin).
export const joplinRichTextCss = `
  ul.joplin-checklist { list-style: none; }
  ul.joplin-checklist li::before {
    content: ""; width: 1em; height: 1em; margin-left: -1.3em;
    position: absolute; border: 1px solid #333; box-sizing: border-box;
  }
  .jop-tinymce ul.joplin-checklist .checked { opacity: 0.5; }
`;

export function pluginCss(): string {
  const style = createCheckboxRenderer({ contentScriptId: "test" })
    .assets({})
    .find((asset) => asset.name === "chx-style");
  return style && style.text ? style.text : "";
}

export function renderWithPlugin(markdown: string): string {
  const md = new MarkdownIt({ linkify: true });
  createCheckboxRenderer({ contentScriptId: "test" }).plugin(md, {
    noteId: "note-1",
  });
  return md.render(markdown);
}

// Turns rendered "[ ] text" / "[x] text" items into Joplin's checkbox markup:
// an <input> in the preview, a class ("checked") in the rich text editor.
export function joplinCheckboxes(
  html: string,
  kind: "preview" | "richText",
): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const item of Array.from(template.content.querySelectorAll("li"))) {
    const text = item.firstChild;
    const match =
      text && text.nodeType === 3
        ? /^\[([ xX])\] ?/.exec(text.textContent || "")
        : null;
    if (!text || !match) continue;
    text.textContent = (text.textContent || "").slice(match[0].length);
    const checked = match[1] !== " ";
    if (kind === "preview") {
      item.classList.add("md-checkbox", "joplin-checkbox");
      const input = document.createElement("input");
      input.type = "checkbox";
      if (checked) input.setAttribute("checked", "");
      item.insertBefore(input, item.firstChild);
    } else {
      if (checked) item.classList.add("checked");
      item.parentElement!.classList.add("joplin-checklist");
    }
  }
  return template.innerHTML;
}

// The plugin side of the messages, keeping Hide States in memory.
export function fakePlugin(stored: Record<string, boolean>) {
  const messages: PluginMessage[] = [];
  return {
    messages,
    postMessage: async (
      _contentScriptId: string,
      message: PluginMessage,
    ): Promise<PluginResponse> => {
      messages.push(message);
      const listId = message.type === "getNoteId" ? "" : message.listId;
      if (message.type === "setState") stored[listId] = message.hideDone;
      return { hideDone: stored[listId] === true, noteId: "note-1", listId };
    },
  };
}

export function webviewScriptUrl(): string {
  return new URL("../.build/checkboxRendererBrowser.js", location.href).href;
}
