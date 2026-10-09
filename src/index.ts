import joplin from "api";
import { ContentScriptType, ModelType } from "api/types";
import stateManager from "./stateManager.ts";
import { createMessageHandler, noteUserData } from "./pluginMessages.ts";

const MARKDOWN_SCRIPT_ID = "checkboxHideMarkdown";
const EDITOR_SCRIPT_ID = "checkboxHideEditor";
const EDITOR_CM5_SCRIPT_ID = "checkboxHideEditorCm5";

stateManager.init(noteUserData(joplin.data, ModelType.Note));

joplin.plugins.register({
  onStart: async function () {
    // -------------------- Renderer (preview pane + rich text editor) --------------------
    // The markdown-it script counts the checkboxes of each list, marks the
    // completed items and renders a "7 / 10" toggle button before the list.
    // The original markdown is kept in a hidden "joplin-source" element so
    // the rich text editor can convert the list back losslessly on save.
    await joplin.contentScripts.register(
      ContentScriptType.MarkdownItPlugin,
      MARKDOWN_SCRIPT_ID,
      "./checkboxRenderer.js",
    );

    // -------------------- Markdown editor (CodeMirror 5 and 6) --------------------
    // The legacy and beta editors use different APIs, so each gets its own script.
    await joplin.contentScripts.register(
      ContentScriptType.CodeMirrorPlugin,
      EDITOR_CM5_SCRIPT_ID,
      "./contentScriptCm5.js",
    );
    await joplin.contentScripts.register(
      ContentScriptType.CodeMirrorPlugin,
      EDITOR_SCRIPT_ID,
      "./contentScript.js",
    );

    // -------------------- Per-note state --------------------
    // The rendered checkbox lists (and the editor) live in different windows
    // that cannot share localStorage, so the remembered state is stored in
    // the note's user data. That is the only place both content scripts can
    // reach: content scripts may post messages to the plugin, and the plugin
    // replies with the value read from the data API.
    const handleStateMessage = createMessageHandler(async function () {
      const note = await joplin.workspace.selectedNote();
      return note ? note.id : "";
    });

    await joplin.contentScripts.onMessage(
      MARKDOWN_SCRIPT_ID,
      handleStateMessage,
    );
    await joplin.contentScripts.onMessage(EDITOR_SCRIPT_ID, handleStateMessage);
    await joplin.contentScripts.onMessage(
      EDITOR_CM5_SCRIPT_ID,
      handleStateMessage,
    );
  },
});
