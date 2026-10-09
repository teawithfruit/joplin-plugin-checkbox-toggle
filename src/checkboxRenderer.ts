// ============================================================================
// CheckboxHide - checkboxRenderer.ts
// ============================================================================
// MarkdownItPlugin content script: injects toggle buttons into the rendered
// markdown (preview pane and rich text editor share this pipeline). Runs in
// Joplin's main/renderer process, so it may require() other project modules.
//
// Click handling and per-note state sync happen in the browser/webview
// instead, in checkboxRendererBrowser.ts, whose built .js this module's
// assets() loads as a plain <script> tag (Joplin never calls back into this
// module from the webview, so that bundle must be self-contained).
// ============================================================================

import listScanner from "./listScanner.ts";
import type { ScannedChecklist } from "./listScanner.ts";
import locale from "./locale.ts";
import clipboard from "./clipboard.ts";
import type { Token } from "markdown-it";
import type { ListId } from "./types.ts";

// The parts of a markdown-it Token the rule reads and writes.
type RendererToken = Pick<
  Token,
  "type" | "attrGet" | "attrSet" | "content" | "nesting" | "map"
>;

// The parts of markdown-it's core state the rule reads and writes.
interface CoreState {
  src: string;
  tokens: RendererToken[];
  Token: new (
    type: string,
    tag: string,
    nesting: Token["nesting"],
  ) => RendererToken;
}

// The parts of a markdown-it instance the plugin registers itself with.
export interface MarkdownItLike {
  core: {
    ruler: { push(ruleName: string, rule: (state: CoreState) => void): void };
  };
}

export interface RuleOptions {
  noteId?: string;
}

export interface Theme {
  color?: string;
  dividerColor?: string;
}

export interface Asset {
  name: string;
  inline?: boolean;
  mime?: string;
  text?: string;
}

interface CheckboxRenderer {
  buildButtonHtml(
    noteId: string,
    listId: ListId,
    depth: number,
    done: number,
    total: number,
    inline?: boolean,
    markdown?: string,
  ): string;
  plugin(markdownIt: MarkdownItLike, options?: RuleOptions): void;
  assets(theme?: Theme): Asset[];
}

const checkboxRenderer_: CheckboxRenderer = {
  // Button HTML template.
  //
  // When the rich text editor saves, Joplin's turndown rebuilds this
  // joplin-editable block from its joplin-source child as open + source +
  // close, so both delimiters must be set there (missing ones become
  // "nullnull"). Turndown surrounds block elements with a blank line, which
  // inside a list item turns the list loose, so a bar inside a list item
  // (`inline`) is built from inline elements only. Everywhere else it must
  // stay a block: the rich text editor wraps top-level inline elements in a
  // <p>, which separates the bar from its list.
  //
  // `markdown` is the Checklist's Markdown as the editors copy it; the copy
  // button carries it so every view copies the same text.
  buildButtonHtml: function (
    noteId,
    listId,
    depth,
    done,
    total,
    inline,
    markdown,
  ) {
    const box = inline ? "span" : "div";
    const source = inline ? "span" : "pre";
    return (
      "<" +
      box +
      ' class="joplin-editable chx-btn-block" data-chx-depth="' +
      depth +
      '">' +
      "<" +
      source +
      ' class="joplin-source" data-joplin-language="md" data-joplin-source-open="" data-joplin-source-close="" hidden></' +
      source +
      ">" +
      "<" +
      box +
      ' class="chx-toolbar">' +
      '<button type="button" class="chx-toggle" aria-pressed="false" data-chx-note="' +
      (noteId || "") +
      '" data-chx-list="' +
      listId +
      '" data-chx-depth="' +
      depth +
      '" data-chx-done="' +
      done +
      '" data-chx-total="' +
      total +
      '">' +
      '<span class="chx-action">' +
      locale.t("hide") +
      "</span>" +
      '<span class="chx-count">' +
      done +
      " / " +
      total +
      "</span>" +
      "</button>" +
      '<button type="button" class="chx-copy" aria-label="' +
      locale.t("copyAria") +
      '" title="' +
      locale.t("copyAria") +
      '" data-chx-note="' +
      (noteId || "") +
      '" data-chx-list="' +
      listId +
      '"' +
      (markdown === undefined
        ? ""
        : ' data-chx-markdown="' + escapeAttribute(markdown) + '"') +
      ">" +
      clipboard.COPY_ICON +
      "</button>" +
      "</" +
      box +
      ">" +
      "</" +
      box +
      ">"
    );
  },

  // Export for markdown-it plugin integration. The key must be named "plugin":
  // that's the contract Joplin's MarkdownItPlugin content scripts require.
  plugin: function (markdownIt, options) {
    const ruleOptions = options || {};
    const noteId = ruleOptions.noteId || "";

    markdownIt.core.ruler.push("checkboxHide", function (state) {
      const tokens = state.tokens;
      const Token = state.Token;

      // List IDs come from the line rule on the note text, never from the
      // token stream (docs/adr/0001). A Checklist is attached to the list
      // token that starts on the same line; unmatched lists get no Button bar.
      const lines = String(state.src || "").split("\n");
      const byStartLine = new Map<number, ScannedChecklist>();
      for (const list of listScanner.scanLines(lines)) {
        byStartLine.set(list.startLine, list);
      }

      // Whether each token sits directly inside a list item.
      const insideListItem: boolean[] = [];
      const openTokens: RendererToken[] = [];
      tokens.forEach(function (token, index) {
        const parent = openTokens[openTokens.length - 1];
        insideListItem[index] = !!parent && parent.type === "list_item_open";
        if (token.nesting === 1) openTokens.push(token);
        else if (token.nesting === -1) openTokens.pop();
      });

      // Insert from right to left so earlier token indices remain stable.
      for (let i = tokens.length - 1; i >= 0; i--) {
        const token = tokens[i];
        if (token.type !== "bullet_list_open" || !token.map) continue;
        const list = byStartLine.get(token.map[0]);
        if (!list) continue;

        token.attrSet(
          "class",
          ((token.attrGet("class") || "") + " chx-list").trim(),
        );
        token.attrSet("data-chx-list", list.listId);
        token.attrSet("data-chx-depth", String(list.depth));
        token.attrSet("data-chx-done", String(list.done));
        token.attrSet("data-chx-total", String(list.total));
        markItems(tokens, i, list.doneLines);

        const buttonToken = new Token("html_block", "", 0);
        buttonToken.content = checkboxRenderer_.buildButtonHtml(
          noteId,
          list.listId,
          list.depth,
          list.done,
          list.total,
          insideListItem[i],
          listScanner.listMarkdown(lines, list),
        );
        tokens.splice(i, 0, buttonToken);
      }
    });
  },

  // Export for assets (CSS and JS)
  assets: function (theme) {
    const css =
      ".chx-list { margin-top: 0; }" +
      ".chx-done-hidden li.chx-done { display: none; }" +
      ".chx-btn-block { display: block; margin: 0 0 8px 0; }" +
      ".chx-toolbar { display: flex; align-items: stretch; margin: 0; border: 1px solid " +
      (theme && theme.dividerColor ? theme.dividerColor : "#ccc") +
      "; border-radius: 4px; overflow: hidden; width: fit-content; }" +
      "button.chx-toggle, button.chx-copy { display: inline-flex; align-items: center; margin: 0; padding: 5px 10px; font-size: 0.85em; line-height: 1.4; color: " +
      (theme && theme.color ? theme.color : "#222") +
      "; background: transparent; border: none; cursor: pointer; font-family: inherit; }" +
      "button.chx-toggle { gap: 10px; }" +
      "button.chx-toggle:hover, button.chx-copy:hover { background: rgba(128,128,128,0.15); }" +
      "button.chx-toggle:focus-visible, button.chx-copy:focus-visible { outline: 2px solid " +
      (theme && theme.color ? theme.color : "#222") +
      "55; outline-offset: -2px; }" +
      "button.chx-toggle .chx-count { padding-left: 10px; border-left: 1px solid " +
      (theme && theme.dividerColor ? theme.dividerColor : "#ccc") +
      "; font-variant-numeric: tabular-nums; }" +
      "button.chx-toggle.chx-hidden { color: #666; }" +
      "button.chx-toggle.chx-hidden .chx-action { color: " +
      (theme && theme.color ? theme.color : "#222") +
      "; }" +
      "button.chx-copy { border-left: 1px solid " +
      (theme && theme.dividerColor ? theme.dividerColor : "#ccc") +
      "; }";
    return [
      {
        name: "chx-style",
        inline: true,
        mime: "text/css",
        text: css,
      },
      {
        name: "checkboxRendererBrowser.js",
      },
    ];
  },
};

function escapeAttribute(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Marks the direct items of the list opened at tokens[openIndex] as done or
// undone, so CSS can hide the done ones.
function markItems(
  tokens: RendererToken[],
  openIndex: number,
  doneLines: number[],
): void {
  let nesting = 0;
  for (let i = openIndex; i < tokens.length; i++) {
    const token = tokens[i];
    if (
      token.type === "bullet_list_open" ||
      token.type === "ordered_list_open"
    ) {
      nesting++;
    } else if (
      token.type === "bullet_list_close" ||
      token.type === "ordered_list_close"
    ) {
      nesting--;
      if (nesting === 0) return;
    } else if (token.type === "list_item_open" && nesting === 1 && token.map) {
      const done = doneLines.indexOf(token.map[0]) >= 0;
      token.attrSet(
        "class",
        (
          (token.attrGet("class") || "") + (done ? " chx-done" : " chx-undone")
        ).trim(),
      );
    }
  }
}

// Export for content script module system. Joplin calls default(context) in
// its main/renderer process and reads .plugin / .assets from the result; it
// never executes this module in the browser, so click handling lives in the
// checkboxRendererBrowser.js asset instead. The export must be a single
// top-level function (matching contentScript.ts's shape): wrapping it in an
// extra { default: fn } object double-nests it after webpack's ESM/commonjs
// interop, and Joplin's require(path).default(context) call would receive an
// object instead of a function.
export default function (_context?: {
  contentScriptId: string;
}): CheckboxRenderer {
  return checkboxRenderer_;
}
