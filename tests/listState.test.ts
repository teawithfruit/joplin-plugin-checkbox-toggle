import assert from "node:assert/strict";
import { test } from "node:test";
import stateManager from "../src/stateManager.ts";
import type { JoplinDataApi, StoredHideStates } from "../src/stateManager.ts";

test("list overrides preserve legacy defaults without changing other lists", async () => {
  stateManager.clearAllCache();
  const stored = new Map<string, unknown>([["note-1", true]]);
  const joplinDataApi: JoplinDataApi = {
    userDataGet: (_itemType, noteId) => Promise.resolve(stored.get(noteId)),
    userDataSet: (_itemType, noteId, _key, value) => {
      stored.set(noteId, value);
      return Promise.resolve();
    },
  };
  stateManager.init(joplinDataApi);

  assert.deepEqual(await stateManager.getState("note-1", "list-0"), {
    hideDone: true,
    noteId: "note-1",
    listId: "list-0",
  });

  await stateManager.setState("note-1", "list-1", false);

  assert.deepEqual(await stateManager.getState("note-1", "list-0"), {
    hideDone: true,
    noteId: "note-1",
    listId: "list-0",
  });
  assert.deepEqual(await stateManager.getState("note-1", "list-1"), {
    hideDone: false,
    noteId: "note-1",
    listId: "list-1",
  });

  stateManager.clearCache("note-1");
  assert.deepEqual(await stateManager.getState("note-1", "list-1"), {
    hideDone: false,
    noteId: "note-1",
    listId: "list-1",
  });
  assert.deepEqual(stored.get("note-1"), {
    version: 2,
    defaultHideDone: true,
    lists: { "list-1": false },
  });
});

test("messages without a list ID keep the note-wide legacy default", async () => {
  stateManager.clearAllCache();
  let stored: StoredHideStates | undefined;
  const joplinDataApi: JoplinDataApi = {
    userDataGet: () => Promise.resolve(stored),
    userDataSet: (_itemType, _noteId, _key, value) => {
      stored = value;
      return Promise.resolve();
    },
  };
  stateManager.init(joplinDataApi);

  await stateManager.setState("note-2", "", true);

  assert.deepEqual(await stateManager.getState("note-2", "list-4"), {
    hideDone: true,
    noteId: "note-2",
    listId: "list-4",
  });
});

function apiReturning(
  read: () => Promise<unknown>,
  write?: () => Promise<void>,
): JoplinDataApi {
  return {
    userDataGet: read,
    userDataSet: write || (() => Promise.resolve()),
  };
}

test("unreadable or malformed stored state reads as everything shown", async () => {
  for (const read of [
    () => Promise.resolve("nonsense"),
    () => Promise.resolve(null),
    () => Promise.resolve({ lists: "not an object", defaultHideDone: "yes" }),
    () => Promise.reject(new Error("disk error")),
  ]) {
    stateManager.clearAllCache();
    stateManager.init(apiReturning(read));
    assert.deepEqual(await stateManager.getState("note-3", "list-0"), {
      hideDone: false,
      noteId: "note-3",
      listId: "list-0",
    });
  }
});

test("a failed write still answers with the new state", async () => {
  stateManager.clearAllCache();
  stateManager.init(
    apiReturning(
      () => Promise.resolve(undefined),
      () => Promise.reject(new Error("read-only")),
    ),
  );
  assert.deepEqual(await stateManager.setState("note-4", "list-2", true), {
    hideDone: true,
    noteId: "note-4",
    listId: "list-2",
  });
  assert.equal(
    (await stateManager.getState("note-4", "list-2")).hideDone,
    true,
  );
});

test("a list override wins over the note-wide default in both directions", async () => {
  stateManager.clearAllCache();
  let stored: unknown = {
    version: 2,
    defaultHideDone: true,
    lists: { "list-1": false },
  };
  stateManager.init(
    apiReturning(
      () => Promise.resolve(stored),
      async () => {},
    ),
  );
  assert.equal(
    (await stateManager.getState("note-5", "list-0")).hideDone,
    true,
  );
  assert.equal(
    (await stateManager.getState("note-5", "list-1")).hideDone,
    false,
  );
  stored = undefined;
});

test("reads are cached per note until the cache is cleared", async () => {
  stateManager.clearAllCache();
  let reads = 0;
  stateManager.init(
    apiReturning(() => {
      reads++;
      return Promise.resolve(undefined);
    }),
  );
  await stateManager.getState("note-6", "list-0");
  await stateManager.getState("note-6", "list-1");
  assert.equal(reads, 1);
  stateManager.clearCache("note-6");
  await stateManager.getState("note-6", "list-0");
  assert.equal(reads, 2);
});
