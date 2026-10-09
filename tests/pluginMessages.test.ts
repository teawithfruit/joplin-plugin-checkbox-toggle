import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import stateManager from "../src/stateManager.ts";
import { createMessageHandler, noteUserData } from "../src/pluginMessages.ts";
import type { JoplinData } from "../src/pluginMessages.ts";

const NOTE_MODEL_TYPE = 1;

// Behaves like joplin.data inside Joplin's plugin sandbox: any property of an
// API function is another API path, and calling it sends an IPC message whose
// arguments must be cloneable. `joplin.data.userDataGet.bind(joplin.data)`
// therefore never yields a working function (the bug that stopped Hide States
// from being stored).
function sandboxData(store: Map<string, unknown>): JoplinData {
  const apiFunction = <F extends (...args: never[]) => unknown>(impl: F) =>
    new Proxy(impl, {
      get(target, property) {
        if (
          property === "bind" ||
          property === "call" ||
          property === "apply"
        ) {
          return () =>
            Promise.reject(new Error("An object could not be cloned"));
        }
        return Reflect.get(target, property);
      },
    });
  return {
    userDataGet: apiFunction(async (type: number, id: string, key: string) => {
      if (type !== NOTE_MODEL_TYPE) throw new Error("bad item type " + type);
      return store.get(id + "/" + key);
    }),
    userDataSet: apiFunction(
      async (type: number, id: string, key: string, value: unknown) => {
        if (type !== NOTE_MODEL_TYPE) throw new Error("bad item type " + type);
        store.set(id + "/" + key, JSON.parse(JSON.stringify(value)));
      },
    ),
  };
}

let store: Map<string, unknown>;
let selectedNoteLookups: number;
let handle: ReturnType<typeof createMessageHandler>;

beforeEach(() => {
  store = new Map();
  selectedNoteLookups = 0;
  stateManager.clearAllCache();
  stateManager.init(noteUserData(sandboxData(store), NOTE_MODEL_TYPE));
  handle = createMessageHandler(async () => {
    selectedNoteLookups++;
    return "selected-note";
  });
});

// A plugin restart: a fresh cache, the same note user data.
function restart() {
  stateManager.clearAllCache();
}

test("a Hide State survives a plugin restart (stored in note user data)", async () => {
  await handle({
    type: "setState",
    noteId: "n1",
    listId: "list-1",
    hideDone: true,
  });
  restart();

  assert.deepEqual(
    await handle({ type: "getState", noteId: "n1", listId: "list-1" }),
    { hideDone: true, noteId: "n1", listId: "list-1" },
  );
  assert.deepEqual(store.get("n1/checkboxHide"), {
    version: 2,
    defaultHideDone: false,
    lists: { "list-1": true },
  });
});

test("Hide States are kept per note and per List ID", async () => {
  await handle({
    type: "setState",
    noteId: "n1",
    listId: "list-0",
    hideDone: true,
  });
  await handle({
    type: "setState",
    noteId: "n2",
    listId: "list-1",
    hideDone: true,
  });
  restart();

  const state = (noteId: string, listId: `list-${number}`) =>
    handle({ type: "getState", noteId, listId }).then((r) => r.hideDone);
  assert.equal(await state("n1", "list-0"), true);
  assert.equal(await state("n1", "list-1"), false);
  assert.equal(await state("n2", "list-0"), false);
  assert.equal(await state("n2", "list-1"), true);
});

test("showing a Checklist again is stored too", async () => {
  await handle({
    type: "setState",
    noteId: "n1",
    listId: "list-0",
    hideDone: true,
  });
  await handle({
    type: "setState",
    noteId: "n1",
    listId: "list-0",
    hideDone: false,
  });
  restart();

  assert.equal(
    (await handle({ type: "getState", noteId: "n1", listId: "list-0" }))
      .hideDone,
    false,
  );
});

test("an empty note ID means the selected note", async () => {
  await handle({
    type: "setState",
    noteId: "",
    listId: "list-0",
    hideDone: true,
  });
  restart();

  assert.deepEqual(
    await handle({
      type: "getState",
      noteId: "selected-note",
      listId: "list-0",
    }),
    { hideDone: true, noteId: "selected-note", listId: "list-0" },
  );
});

test("the selected note is only looked up when no note ID is given", async () => {
  await handle({ type: "getState", noteId: "n1", listId: "list-0" });
  assert.equal(selectedNoteLookups, 0);
  await handle({ type: "getState", noteId: "", listId: "list-0" });
  assert.equal(selectedNoteLookups, 1);
});

test("getNoteId answers with the selected note", async () => {
  assert.deepEqual(await handle({ type: "getNoteId" }), {
    hideDone: false,
    noteId: "selected-note",
  });
});

test("setState without any note stores nothing", async () => {
  const noNote = createMessageHandler(async () => "");
  assert.deepEqual(
    await noNote({
      type: "setState",
      noteId: "",
      listId: "list-0",
      hideDone: true,
    }),
    { hideDone: false, noteId: "", listId: "list-0" },
  );
  assert.equal(store.size, 0);
});

test("missing and unknown messages get a harmless answer", async () => {
  assert.deepEqual(await handle(null), { hideDone: false, noteId: "" });
  assert.deepEqual(await handle(undefined), { hideDone: false, noteId: "" });
  assert.deepEqual(
    await handle({ type: "somethingElse" } as unknown as Parameters<
      typeof handle
    >[0]),
    { hideDone: false, noteId: "selected-note" },
  );
});

test("a failing note lookup falls back to the default instead of throwing", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const failing = createMessageHandler(async () => {
      throw new Error("no window");
    });
    assert.deepEqual(await failing({ type: "getNoteId" }), {
      hideDone: false,
      noteId: "",
    });
  } finally {
    console.warn = warn;
  }
});

test("noteUserData passes the note ModelType, not the 'note' string", async () => {
  const calls: unknown[][] = [];
  const data: JoplinData = {
    userDataGet: async (...args) => void calls.push(["get", ...args]),
    userDataSet: async (...args) => void calls.push(["set", ...args]),
  };
  const api = noteUserData(data, NOTE_MODEL_TYPE);
  await api.userDataGet("note", "n1", "checkboxHide");
  await api.userDataSet("note", "n1", "checkboxHide", {
    version: 2,
    defaultHideDone: false,
    lists: {},
  });

  assert.deepEqual(calls[0], ["get", NOTE_MODEL_TYPE, "n1", "checkboxHide"]);
  assert.equal(calls[1][1], NOTE_MODEL_TYPE);
});
