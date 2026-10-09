// ============================================================================
// CheckboxHide - stateManager.ts
// ============================================================================
// Shared state management utilities for both renderer and editor content scripts.
// Handles per-note state persistence via plugin data API.
// ============================================================================

import type { HideState, ListId } from "./types.ts";

// The note user data calls this module needs from joplin.data.
export interface JoplinDataApi {
  userDataGet(itemType: "note", noteId: string, key: string): Promise<unknown>;
  userDataSet(
    itemType: "note",
    noteId: string,
    key: string,
    value: StoredHideStates,
  ): Promise<unknown>;
}

// One note's Hide States as stored in its user data. Keys of `lists` are
// List IDs, but data written by older versions may hold other keys.
export interface StoredHideStates {
  version: 2;
  defaultHideDone: boolean;
  lists: Record<string, boolean>;
}

interface StateManager {
  USER_DATA_KEY: string;
  stateCache: Record<string, StoredHideStates>;
  joplinDataApi?: JoplinDataApi;
  init(joplinDataApi: JoplinDataApi): void;
  getState(noteId: string, listId?: ListId | ""): Promise<HideState>;
  normalizeState(value: unknown): StoredHideStates;
  readListState(noteId: string, listId?: ListId | ""): HideState;
  setState(
    noteId: string,
    listId: ListId | "" | undefined,
    hideDone: boolean,
  ): Promise<HideState>;
  getStateData(noteId: string): Promise<StoredHideStates>;
  clearCache(noteId: string): void;
  clearAllCache(): void;
}

const chxStateManager_: StateManager = {
  // User data key for per-note hide/show state
  USER_DATA_KEY: "checkboxHide",

  // Cache per note
  stateCache: {},

  // Initialize with Joplin API
  init: function (joplinDataApi) {
    this.joplinDataApi = joplinDataApi;
  },

  // Get state for a note
  getState: function (noteId, listId) {
    if (!this.joplinDataApi) {
      return Promise.resolve({
        hideDone: false,
        noteId: "",
        listId: listId || "",
      });
    }
    if (noteId && this.stateCache[noteId] !== undefined) {
      return Promise.resolve(this.readListState(noteId, listId));
    }
    if (!noteId) {
      return Promise.resolve({
        hideDone: false,
        noteId: "",
        listId: listId || "",
      });
    }
    return this.joplinDataApi
      .userDataGet("note", noteId, chxStateManager_.USER_DATA_KEY)
      .then(
        function (value: unknown) {
          chxStateManager_.stateCache[noteId] =
            chxStateManager_.normalizeState(value);
          return chxStateManager_.readListState(noteId, listId);
        },
        function () {
          // Error reading user data
          chxStateManager_.stateCache[noteId] =
            chxStateManager_.normalizeState(false);
          return chxStateManager_.readListState(noteId, listId);
        },
      );
  },

  normalizeState: function (value) {
    if (typeof value === "boolean") {
      return { version: 2, defaultHideDone: value, lists: {} };
    }
    if (!value || typeof value !== "object") {
      return { version: 2, defaultHideDone: false, lists: {} };
    }
    const stored = value as Partial<StoredHideStates>;
    return {
      version: 2,
      defaultHideDone: stored.defaultHideDone === true,
      lists:
        stored.lists && typeof stored.lists === "object" ? stored.lists : {},
    };
  },

  readListState: function (noteId, listId) {
    const state = chxStateManager_.stateCache[noteId];
    const hasOverride =
      !!listId && Object.prototype.hasOwnProperty.call(state.lists, listId);
    return {
      hideDone:
        hasOverride && listId
          ? state.lists[listId] === true
          : state.defaultHideDone,
      noteId: noteId,
      listId: listId || "",
    };
  },

  // Set state for a note's list
  setState: function (noteId, listId, hideDone) {
    if (!this.joplinDataApi || !noteId) {
      return Promise.resolve({
        hideDone: hideDone,
        noteId: noteId || "",
        listId: listId || "",
      });
    }
    const joplinDataApi = this.joplinDataApi;
    return chxStateManager_.getStateData(noteId).then(function (state) {
      if (listId) {
        state.lists[listId] = hideDone === true;
      } else {
        state.defaultHideDone = hideDone === true;
      }
      chxStateManager_.stateCache[noteId] = state;
      return joplinDataApi
        .userDataSet("note", noteId, chxStateManager_.USER_DATA_KEY, state)
        .then(
          function () {
            return chxStateManager_.readListState(noteId, listId);
          },
          function () {
            // Error writing user data
            return chxStateManager_.readListState(noteId, listId);
          },
        );
    });
  },

  getStateData: function (noteId) {
    if (chxStateManager_.stateCache[noteId] !== undefined) {
      return Promise.resolve(chxStateManager_.stateCache[noteId]);
    }
    if (!this.joplinDataApi) {
      return Promise.resolve(chxStateManager_.normalizeState(false));
    }
    return this.joplinDataApi
      .userDataGet("note", noteId, chxStateManager_.USER_DATA_KEY)
      .then(
        function (value) {
          const state = chxStateManager_.normalizeState(value);
          chxStateManager_.stateCache[noteId] = state;
          return state;
        },
        function () {
          const state = chxStateManager_.normalizeState(false);
          chxStateManager_.stateCache[noteId] = state;
          return state;
        },
      );
  },

  // Clear cache for a note (optional cleanup)
  clearCache: function (noteId) {
    if (noteId) delete chxStateManager_.stateCache[noteId];
  },

  // Clear all cache
  clearAllCache: function () {
    chxStateManager_.stateCache = {};
  },
};

export default chxStateManager_;
