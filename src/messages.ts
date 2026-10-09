// ============================================================================
// CheckboxHide - messages.ts
// ============================================================================
// The message protocol between the content scripts and the plugin
// (index.ts). Type-only: nothing here exists at runtime.
// ============================================================================

import type { HideState, ListId } from "./types.ts";

// Asks which note the editor shows (CM5 has no note ID of its own).
export interface GetNoteIdMessage {
  type: "getNoteId";
}

// Reads one Checklist's Hide State. An empty noteId means "the selected note".
export interface GetStateMessage {
  type: "getState";
  noteId: string;
  listId: ListId | "";
}

// Persists one Checklist's Hide State. An empty noteId means "the selected
// note"; an empty listId sets the note-wide default.
export interface SetStateMessage {
  type: "setState";
  noteId: string;
  listId: ListId | "";
  hideDone: boolean;
}

export type PluginMessage =
  GetNoteIdMessage | GetStateMessage | SetStateMessage;

// getNoteId is answered with hideDone false and no listId.
export type PluginResponse = Omit<HideState, "listId"> &
  Partial<Pick<HideState, "listId">>;

// The part of Joplin's content script context the content scripts use.
export interface ContentScriptContext {
  postMessage(message: PluginMessage): Promise<PluginResponse>;
}
