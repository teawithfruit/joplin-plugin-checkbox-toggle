// ============================================================================
// CheckboxHide - pluginMessages.ts
// ============================================================================
// The plugin side of the message protocol (messages.ts): answers the content
// scripts' getNoteId / getState / setState messages from the Hide States in
// note user data. Kept free of Joplin's `api` module so it can be tested;
// index.ts wires it to the real joplin object.
// ============================================================================

import stateManager from "./stateManager.ts";
import type { JoplinDataApi } from "./stateManager.ts";
import type { PluginMessage, PluginResponse } from "./messages.ts";

// The parts of joplin.data the plugin uses.
export interface JoplinData {
  userDataGet(itemType: number, itemId: string, key: string): Promise<unknown>;
  userDataSet(
    itemType: number,
    itemId: string,
    key: string,
    value: unknown,
  ): Promise<unknown>;
}

// Note user data for stateManager. The calls are wrapped instead of passing
// bound methods: in the plugin sandbox `joplin.data.userDataGet.bind(...)` is
// itself sent as an API call (and fails to clone `joplin.data`), so nothing
// would ever be stored. The data API also wants the note ModelType, not the
// "note" string stateManager passes.
export function noteUserData(
  data: JoplinData,
  noteModelType: number,
): JoplinDataApi {
  return {
    userDataGet: function (_itemType, noteId, key) {
      return data.userDataGet(noteModelType, noteId, key);
    },
    userDataSet: function (_itemType, noteId, key, value) {
      return data.userDataSet(noteModelType, noteId, key, value);
    },
  };
}

// Answers one content script message. An empty noteId means "the selected
// note", which selectedNoteId() looks up only when needed.
export function createMessageHandler(
  selectedNoteId: () => Promise<string>,
): (message: PluginMessage | null | undefined) => Promise<PluginResponse> {
  return async function (message) {
    if (!message) return { hideDone: false, noteId: "" };
    try {
      const requestedNoteId =
        message.type === "getNoteId" ? "" : message.noteId || "";
      const noteId = requestedNoteId || (await selectedNoteId());
      if (message.type === "getNoteId") {
        return { hideDone: false, noteId };
      }
      if (message.type === "getState") {
        return stateManager.getState(noteId, message.listId);
      }
      if (message.type === "setState") {
        if (noteId) {
          return stateManager.setState(
            noteId,
            message.listId,
            !!message.hideDone,
          );
        }
        return { hideDone: false, noteId: "", listId: message.listId || "" };
      }
      // Messages of an unknown type still learn the note ID.
      return { hideDone: false, noteId };
    } catch (e) {
      console.warn("CheckboxHide: could not read or write note user data:", e);
      return { hideDone: false, noteId: "" };
    }
  };
}
