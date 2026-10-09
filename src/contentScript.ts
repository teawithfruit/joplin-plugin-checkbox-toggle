import { StateEffect, StateField } from "@codemirror/state";
import type {
  EditorState,
  Extension,
  Facet,
  Range,
  StateEffectType,
  Text,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { DecorationSet, ViewUpdate } from "@codemirror/view";
import locale from "./locale.ts";
import clipboard from "./clipboard.ts";
import listScanner from "./listScanner.ts";
import type { ScannedChecklist } from "./listScanner.ts";
import type { ContentScriptContext } from "./messages.ts";
import type { ListId } from "./types.ts";

// The parts of Joplin's CodeMirrorControl this script uses.
interface Cm6Control {
  cm6?: EditorView;
  addExtension?(extension: Extension): void;
  joplinExtensions?: {
    noteIdFacet?: Facet<string, string>;
    setNoteIdEffect?: StateEffectType<string>;
  };
}

// The editor's Hide States for the note it shows.
interface EditorHideStates {
  noteId: string;
  hideDoneByList: Partial<Record<ListId, boolean>>;
}

class ToggleWidget extends WidgetType {
  done: number;
  total: number;
  hideDone: boolean;
  listId: ListId;
  // The Checklist's item lines, relative to its first line.
  itemOffsets: number[];

  constructor(
    done: number,
    total: number,
    hideDone: boolean,
    listId: ListId,
    itemOffsets: number[],
  ) {
    super();
    this.done = done;
    this.total = total;
    this.hideDone = hideDone;
    this.listId = listId;
    this.itemOffsets = itemOffsets;
  }

  eq(other: ToggleWidget): boolean {
    return (
      this.done === other.done &&
      this.total === other.total &&
      this.hideDone === other.hideDone &&
      this.listId === other.listId &&
      this.itemOffsets.join() === other.itemOffsets.join()
    );
  }

  toDOM(): HTMLElement {
    // CodeMirror measures block widgets without their margins, so every
    // margin would shift click positions below the widget; the outer element
    // spaces and indents the toolbar with padding instead.
    const container = document.createElement("div");
    container.className = "chx-cm-widget";
    // Read by alignBars, which lines the toolbar up with the list's bullet.
    container.dataset.chxItemOffsets = this.itemOffsets.join(",");

    const wrapper = document.createElement("div");
    wrapper.className = "chx-cm-toolbar";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "chx-cm-toggle";
    const action = document.createElement("span");
    action.className = "chx-cm-action";
    action.textContent = this.hideDone ? locale.t("show") : locale.t("hide");
    const count = document.createElement("span");
    count.className = "chx-cm-count";
    count.textContent = this.done + " / " + this.total;
    button.appendChild(action);
    button.appendChild(count);
    button.setAttribute("aria-label", locale.t("ariaToggle"));
    button.setAttribute("aria-pressed", String(this.hideDone));
    button.setAttribute("data-chx-list", this.listId);

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "chx-cm-copy";
    copyButton.setAttribute("aria-label", locale.t("copyAria"));
    copyButton.title = locale.t("copyAria");
    copyButton.setAttribute("data-chx-list", this.listId);
    copyButton.innerHTML = clipboard.COPY_ICON;

    wrapper.appendChild(button);
    wrapper.appendChild(copyButton);
    container.appendChild(wrapper);
    return container;
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== "click";
  }
}

function readNoteId(
  state: EditorState,
  noteIdFacet: Facet<string, string> | undefined,
): string {
  if (!noteIdFacet) return "";
  return state.facet(noteIdFacet) || "";
}

// Where the first thing on a line is drawn (Joplin's checkbox widget or the
// bullet), also for a collapsed hidden line. Measured in the DOM, because
// Joplin replaces the bullet with a widget and indents list lines itself.
function drawnStart(view: EditorView, lineStart: number): number | null {
  const found = view.domAtPos(lineStart).node;
  const element =
    found.nodeType === 1 ? (found as Element) : found.parentElement;
  const line = element && element.closest<HTMLElement>(".cm-line");
  if (!line) return null;

  const walker = document.createTreeWalker(
    line,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === 3) {
      const text = node.textContent || "";
      const index = text.search(/\S/);
      if (index < 0) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 1);
      return range.getBoundingClientRect().left;
    }
    if (!node.firstChild) {
      const rect = (node as Element).getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return rect.left;
    }
  }
  return null;
}

// Starts every toolbar where its list's bullet is drawn, as in the rich text
// editor. Measured rather than computed, because Joplin draws list lines with
// its own indentation and checkbox widgets, and redone on every update since
// fonts, decorations and edits move the lines.
const alignBars = ViewPlugin.define(function (view) {
  function align(): void {
    view.requestMeasure({
      key: alignBars,
      read: function () {
        const doc = view.state.doc;
        const bars = Array.from(
          view.contentDOM.querySelectorAll<HTMLElement>(".chx-cm-widget"),
        );
        return bars.map(function (bar) {
          const first = doc.lineAt(view.posAtDOM(bar)).number;
          const offsets = (bar.dataset.chxItemOffsets || "0").split(",");
          for (const offset of offsets) {
            const number = first + Number(offset);
            if (number > doc.lines) break;
            const left = drawnStart(view, doc.line(number).from);
            if (left !== null) {
              const padding = left - bar.getBoundingClientRect().left;
              return { bar: bar, padding: Math.max(0, padding) + "px" };
            }
          }
          return { bar: bar, padding: "" };
        });
      },
      write: function (measured) {
        for (const { bar, padding } of measured) {
          if (padding && bar.style.paddingLeft !== padding) {
            bar.style.paddingLeft = padding;
          }
        }
      },
    });
  }
  align();
  return { update: align };
});

// The note's Checklists, from the one identity rule every view shares
// (docs/adr/0001).
function scanDoc(doc: Text): { lines: string[]; lists: ScannedChecklist[] } {
  const lines = doc.toString().split("\n");
  return { lines: lines, lists: listScanner.scanLines(lines) };
}

function buildDecorations(
  state: EditorState,
  savedState: EditorHideStates,
): DecorationSet {
  const doc = state.doc;
  const decorations: Array<Range<Decoration>> = [];

  for (const list of scanDoc(doc).lists) {
    decorations.push(
      Decoration.widget({
        widget: new ToggleWidget(
          list.done,
          list.total,
          savedState.hideDoneByList[list.listId] === true,
          list.listId,
          list.itemLines.map(function (line) {
            return line - list.startLine;
          }),
        ),
        block: true,
        side: -1,
      }).range(doc.line(list.startLine + 1).from),
    );

    // Done items hide with their own Checklist and with every enclosing one.
    const hidden = [list.listId, ...list.parentIds].some(function (listId) {
      return savedState.hideDoneByList[listId] === true;
    });
    if (!hidden) continue;
    for (const line of list.doneLines) {
      decorations.push(
        Decoration.line({
          attributes: { class: "chx-cm-done-hidden" },
        }).range(doc.line(line + 1).from),
      );
    }
  }

  return Decoration.set(decorations, true);
}

export default function (context?: ContentScriptContext) {
  return {
    plugin: function (control?: Cm6Control) {
      if (!control || !control.cm6 || !control.addExtension) {
        return;
      }

      const noteIdFacet =
        control.joplinExtensions && control.joplinExtensions.noteIdFacet;
      const setNoteIdEffect =
        control.joplinExtensions && control.joplinExtensions.setNoteIdEffect;
      const setHideStates = StateEffect.define<EditorHideStates>();
      const hideStateField = StateField.define<EditorHideStates>({
        create: function (state) {
          return {
            noteId: readNoteId(state, noteIdFacet),
            hideDoneByList: {},
          };
        },
        update: function (value, transaction) {
          if (
            setNoteIdEffect &&
            transaction.effects.some(function (effect) {
              return effect.is(setNoteIdEffect);
            })
          ) {
            return {
              noteId: readNoteId(transaction.state, noteIdFacet),
              hideDoneByList: {},
            };
          }
          for (let i = 0; i < transaction.effects.length; i++) {
            const effect = transaction.effects[i];
            if (effect.is(setHideStates)) return effect.value;
          }
          return value;
        },
      });
      const decorationsField = StateField.define<DecorationSet>({
        create: function (state) {
          return buildDecorations(state, state.field(hideStateField));
        },
        update: function (_decorations, transaction) {
          return buildDecorations(
            transaction.state,
            transaction.state.field(hideStateField),
          );
        },
        provide: function (field) {
          return EditorView.decorations.from(field);
        },
      });

      function loadState(view: EditorView, noteId: string): void {
        if (!noteId || !context || !context.postMessage) return;
        Promise.all(
          scanDoc(view.state.doc).lists.map(function ({ listId }) {
            return context
              .postMessage({ type: "getState", noteId: noteId, listId: listId })
              .then(function (result): [ListId, boolean] {
                return [listId, !!result.hideDone];
              });
          }),
        ).then(
          function (entries) {
            if (readNoteId(view.state, noteIdFacet) !== noteId) return;
            const hideDoneByList: Partial<Record<ListId, boolean>> = {};
            entries.forEach(function (entry) {
              hideDoneByList[entry[0]] = entry[1];
            });
            view.dispatch({
              effects: setHideStates.of({
                noteId: noteId,
                hideDoneByList: hideDoneByList,
              }),
            });
          },
          function (error) {
            console.warn("CheckboxHide: could not read editor state:", error);
          },
        );
      }

      const noteSync = ViewPlugin.define(function (view) {
        let noteId = readNoteId(view.state, noteIdFacet);
        loadState(view, noteId);
        return {
          update: function (update: ViewUpdate) {
            const nextNoteId = readNoteId(update.state, noteIdFacet);
            if (nextNoteId !== noteId) {
              noteId = nextNoteId;
              loadState(update.view, noteId);
            }
          },
        };
      });

      const clickHandler = EditorView.domEventHandlers({
        click: function (event, view) {
          const target = event.target as Element | null;
          const toggleButton =
            target && target.closest
              ? target.closest("button.chx-cm-toggle")
              : null;
          if (toggleButton) {
            const current = view.state.field(hideStateField);
            // ToggleWidget wrote a List ID into data-chx-list.
            const listId = (toggleButton.getAttribute("data-chx-list") ||
              "") as ListId;
            const hideDoneByList = Object.assign({}, current.hideDoneByList);
            hideDoneByList[listId] = hideDoneByList[listId] !== true;
            const nextState: EditorHideStates = {
              noteId: current.noteId,
              hideDoneByList: hideDoneByList,
            };
            view.dispatch({ effects: setHideStates.of(nextState) });
            if (nextState.noteId && context && context.postMessage) {
              context
                .postMessage({
                  type: "setState",
                  noteId: nextState.noteId,
                  listId: listId,
                  hideDone: hideDoneByList[listId] === true,
                })
                .catch(function (error) {
                  console.warn(
                    "CheckboxHide: could not save editor state:",
                    error,
                  );
                });
            }
            return true;
          }

          const copyButton =
            target && target.closest
              ? target.closest("button.chx-cm-copy")
              : null;
          if (copyButton) {
            const copyListId = copyButton.getAttribute("data-chx-list") || "";
            const { lines, lists } = scanDoc(view.state.doc);
            const list = lists.find(function (entry) {
              return entry.listId === copyListId;
            });
            if (list) {
              clipboard.copyToClipboard(listScanner.listMarkdown(lines, list));
              clipboard.flashCopied(copyButton);
            }
            return true;
          }

          return false;
        },
      });

      control.addExtension([
        hideStateField,
        decorationsField,
        noteSync,
        alignBars,
        clickHandler,
        EditorView.baseTheme({
          ".chx-cm-widget": {
            paddingBottom: "4px",
          },
          ".chx-cm-toolbar": {
            display: "flex",
            alignItems: "stretch",
            border: "1px solid var(--joplin-divider-color)",
            borderRadius: "4px",
            overflow: "hidden",
            width: "fit-content",
          },
          ".chx-cm-toggle, .chx-cm-copy": {
            display: "inline-flex",
            alignItems: "center",
            color: "var(--joplin-color)",
            backgroundColor: "transparent",
            border: "none",
            cursor: "pointer",
            font: "inherit",
            fontSize: "0.85em",
            lineHeight: "1.4",
            padding: "2px 8px",
          },
          ".chx-cm-toggle": {
            gap: "10px",
          },
          ".chx-cm-toggle:hover, .chx-cm-copy:hover": {
            backgroundColor: "rgba(128,128,128,0.15)",
          },
          ".chx-cm-count": {
            borderLeft: "1px solid var(--joplin-divider-color)",
            fontVariantNumeric: "tabular-nums",
            paddingLeft: "10px",
          },
          ".chx-cm-copy": {
            borderLeft: "1px solid var(--joplin-divider-color)",
          },
          // Collapsed rather than display: none, so a hidden line keeps its
          // horizontal layout and alignBars can still line a Button bar up
          // with it when every item of a Checklist is hidden.
          ".chx-cm-done-hidden": {
            height: "0",
            minHeight: "0",
            paddingTop: "0",
            paddingBottom: "0",
            marginTop: "0",
            marginBottom: "0",
            overflow: "hidden",
            visibility: "hidden",
          },
        }),
      ]);
    },
  };
}
