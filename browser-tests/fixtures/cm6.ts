// Test page: the CM6 content script in a real CodeMirror 6 editor.
import {
  EditorState,
  Facet,
  RangeSetBuilder,
  StateEffect,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import createContentScript from "../../src/contentScript.ts";
import { fakePlugin } from "./joplin.ts";

// A stand-in for Joplin's Markdown editor rendering: "- [ ] " is replaced by
// a checkbox widget and list lines get their own indentation per level.
class CheckboxWidget extends WidgetType {
  checked: boolean;
  constructor(checked: boolean) {
    super();
    this.checked = checked;
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "joplin-like-checkbox";
    input.checked = this.checked;
    return input;
  }
}

function joplinLikeDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let number = 1; number <= view.state.doc.lines; number++) {
    const line = view.state.doc.line(number);
    const match = /^(\s*)[-*+] \[([ xX])\] /.exec(line.text);
    if (!match) continue;
    const level = Math.floor(match[1].replace(/\t/g, "    ").length / 4);
    builder.add(
      line.from,
      line.from,
      Decoration.line({
        attributes: { style: `padding-left: ${10 + level * 7}px` },
      }),
    );
    builder.add(
      line.from + match[1].length,
      line.from + match[0].length,
      Decoration.replace({ widget: new CheckboxWidget(match[2] !== " ") }),
    );
  }
  return builder.finish();
}

const joplinLike = [
  ViewPlugin.define(
    (view) => ({
      decorations: joplinLikeDecorations(view),
      update(update: ViewUpdate) {
        if (update.docChanged)
          this.decorations = joplinLikeDecorations(update.view);
      },
    }),
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.theme({ ".cm-content": { fontFamily: "sans-serif" } }),
];

declare global {
  interface Window {
    mountEditor(
      doc: string,
      options?: { joplinLike?: boolean; hidden?: string[] },
    ): void;
    view: EditorView;
    pluginMessages: unknown[];
  }
}

window.mountEditor = function (doc, options = {}) {
  const stored: Record<string, boolean> = {};
  for (const listId of options.hidden || []) stored[listId] = true;
  const plugin = fakePlugin(stored);
  window.pluginMessages = plugin.messages;

  const noteIdFacet = Facet.define<string, string>({
    combine: (values) => values[0] || "",
  });
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        noteIdFacet.of("note-1"),
        options.joplinLike ? joplinLike : [],
      ],
    }),
    parent: document.getElementById("editor")!,
  });
  createContentScript({
    postMessage: (message) => plugin.postMessage("checkboxHideEditor", message),
  }).plugin({
    cm6: view,
    addExtension: (extension) =>
      view.dispatch({ effects: StateEffect.appendConfig.of(extension) }),
    joplinExtensions: { noteIdFacet },
  });
  window.view = view;
};
