import locale from "./locale.ts";
import clipboard from "./clipboard.ts";
import listScanner from "./listScanner.ts";
import type { ScannedChecklist } from "./listScanner.ts";
import type { ContentScriptContext } from "./messages.ts";
import type { ListId } from "./types.ts";

// The parts of the CodeMirror 5 API this script uses.
interface Cm5LineWidget {
  clear(): void;
}

interface Cm5Change {
  origin?: string;
}

interface Cm5Editor {
  _checkboxHideInitialized?: boolean;
  lineCount(): number;
  getLine(line: number): string;
  addLineClass(line: number, where: "wrap", className: string): unknown;
  removeLineClass(line: number, where: "wrap", className: string): unknown;
  addLineWidget(
    line: number,
    node: HTMLElement,
    options: { above?: boolean; noHScroll?: boolean },
  ): Cm5LineWidget;
  on(
    event: "changes",
    handler: (editor: Cm5Editor, changes: Cm5Change[]) => void,
  ): void;
  on(event: "swapDoc", handler: () => void): void;
}

interface Cm5 {
  cm6?: unknown;
  defineOption(
    name: string,
    defaultValue: unknown,
    handler: (this: Cm5Editor | undefined, enabled: unknown) => void,
  ): void;
}

export default function (context?: ContentScriptContext) {
  return {
    plugin: function (CodeMirror?: Cm5) {
      if (!CodeMirror || CodeMirror.cm6 || !CodeMirror.defineOption) return;

      // Read noteId from context if available (Joplin passes it in context)
      // Note: CM5 content scripts don't receive noteId in context, so we get it from plugin

      CodeMirror.defineOption("checkboxHide", false, function (enabled) {
        if (!enabled) return;
        // When the option is applied via setOption(), CodeMirror 5 runs the
        // handler with the editor as `this`.
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const maybeEditor = this;
        if (!maybeEditor || !maybeEditor.addLineWidget) {
          console.warn("CheckboxHide: CM5 line widgets are unavailable.");
          return;
        }
        const editor: Cm5Editor = maybeEditor;
        if (editor._checkboxHideInitialized) return;
        editor._checkboxHideInitialized = true;

        let hideDoneByList: Partial<Record<ListId, boolean>> = {};
        let widgets: Cm5LineWidget[] = [];
        let hiddenLines: number[] = [];
        let stateRequest = 0;
        let savedNoteId = "";

        function clearDecorations(): void {
          widgets.forEach(function (widget) {
            widget.clear();
          });
          hiddenLines.forEach(function (line) {
            editor.removeLineClass(line, "wrap", "chx-cm5-done-hidden");
          });
          widgets = [];
          hiddenLines = [];
        }

        function editorLines(): string[] {
          const lines: string[] = [];
          for (let line = 0; line < editor.lineCount(); line++) {
            lines.push(editor.getLine(line));
          }
          return lines;
        }

        // The note's Checklists, from the one identity rule every view
        // shares (docs/adr/0001).
        function scanLists(): ScannedChecklist[] {
          return listScanner.scanLines(editorLines());
        }

        function render(): void {
          clearDecorations();
          const lists = scanLists();
          lists.forEach(function (list) {
            if (
              hideDoneByList[list.listId] === true ||
              list.parentIds.some(function (parentId) {
                return hideDoneByList[parentId] === true;
              })
            ) {
              list.doneLines.forEach(function (line) {
                editor.addLineClass(line, "wrap", "chx-cm5-done-hidden");
                hiddenLines.push(line);
              });
            }

            const wrapper = document.createElement("div");
            wrapper.className = "chx-cm5-widget";
            // Start the toolbar where the list's bullet starts, as in the
            // rich text editor: the list's own leading whitespace is rendered
            // in the editor's font.
            const indent = document.createElement("span");
            indent.className = "chx-cm5-indent";
            indent.textContent = editor
              .getLine(list.startLine)
              .slice(0, list.indentLength);
            wrapper.appendChild(indent);
            const toolbar = document.createElement("div");
            toolbar.className = "chx-cm5-toolbar";
            const button = document.createElement("button");
            button.type = "button";
            button.className = "chx-cm5-toggle";
            const isListHidden = hideDoneByList[list.listId] === true;
            button.setAttribute("data-chx-list", list.listId);
            button.setAttribute("aria-pressed", String(isListHidden));
            const action = document.createElement("span");
            action.textContent = isListHidden
              ? locale.t("show")
              : locale.t("hide");
            const count = document.createElement("span");
            count.className = "chx-cm5-count";
            count.textContent = list.done + " / " + list.total;
            button.appendChild(action);
            button.appendChild(count);
            button.addEventListener("mousedown", function (event) {
              event.preventDefault();
            });
            button.addEventListener("click", function (event) {
              event.preventDefault();
              event.stopPropagation();
              hideDoneByList[list.listId] = !isListHidden;
              render();
              if (context && context.postMessage && savedNoteId) {
                // Use the saved noteId from plugin's response
                context
                  .postMessage({
                    type: "setState",
                    noteId: savedNoteId,
                    listId: list.listId,
                    hideDone: hideDoneByList[list.listId] === true,
                  })
                  .catch(function (error) {
                    console.warn(
                      "CheckboxHide: could not save CM5 state:",
                      error,
                    );
                  });
              }
            });

            const copyButton = document.createElement("button");
            copyButton.type = "button";
            copyButton.className = "chx-cm5-copy";
            copyButton.setAttribute("aria-label", locale.t("copyAria"));
            copyButton.title = locale.t("copyAria");
            copyButton.innerHTML = clipboard.COPY_ICON;
            copyButton.addEventListener("mousedown", function (event) {
              event.preventDefault();
            });
            copyButton.addEventListener("click", function (event) {
              event.preventDefault();
              event.stopPropagation();
              clipboard.copyToClipboard(
                listScanner.listMarkdown(editorLines(), list),
              );
              clipboard.flashCopied(copyButton);
            });

            toolbar.appendChild(button);
            toolbar.appendChild(copyButton);
            wrapper.appendChild(toolbar);
            widgets.push(
              editor.addLineWidget(list.startLine, wrapper, {
                above: true,
                noHScroll: true,
              }),
            );
          });
        }

        function loadState(): void {
          if (!context || !context.postMessage) return;
          // First, request the noteId from the plugin
          context.postMessage({ type: "getNoteId" }).then(
            function (noteIdResult) {
              const currentNoteId = noteIdResult.noteId || "";
              if (!currentNoteId) {
                console.warn("CheckboxHide: could not get noteId from plugin");
                return;
              }
              savedNoteId = currentNoteId;
              const request = ++stateRequest;
              Promise.all(
                scanLists().map(function (list) {
                  return context
                    .postMessage({
                      type: "getState",
                      noteId: currentNoteId,
                      listId: list.listId,
                    })
                    .then(function (result): [ListId, boolean] {
                      return [list.listId, !!result.hideDone];
                    });
                }),
              ).then(
                function (entries) {
                  if (request !== stateRequest) return;
                  hideDoneByList = {};
                  entries.forEach(function (entry) {
                    hideDoneByList[entry[0]] = entry[1];
                  });
                  render();
                },
                function (error) {
                  console.warn(
                    "CheckboxHide: could not read CM5 state:",
                    error,
                  );
                },
              );
            },
            function (error) {
              console.warn("CheckboxHide: could not get noteId:", error);
            },
          );
        }

        editor.on("changes", function (_editor, changes) {
          render();
          if (
            changes.some(function (change) {
              return change.origin === "setValue";
            })
          ) {
            loadState();
          }
        });
        editor.on("swapDoc", loadState);
        loadState();
        render();
      });
    },
    codeMirrorOptions: {
      checkboxHide: true,
    },
    assets: function () {
      return [{ name: "./checkboxHideCm5.css" }];
    },
  };
}
