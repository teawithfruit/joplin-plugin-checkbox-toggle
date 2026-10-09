import assert from "node:assert/strict";
import { test } from "node:test";
import listScanner from "../src/listScanner.ts";

test("assigns ids in open order, parents before nested lists", () => {
  const lists = listScanner.scanLines([
    "- [ ] a",
    "  - [x] b",
    "- [x] c",
    "Text",
    "- [ ] d",
  ]);
  assert.deepEqual(
    lists.map((l) => [
      l.listId,
      l.depth,
      l.done,
      l.total,
      l.startLine,
      l.endLine,
    ]),
    [
      ["list-0", 0, 1, 2, 0, 2],
      ["list-1", 1, 1, 1, 1, 1],
      ["list-2", 0, 0, 1, 4, 4],
    ],
  );
  assert.deepEqual(lists[1].parentIds, ["list-0"]);
  assert.deepEqual(lists[0].doneLines, [2]);
});

test("tabs count as four spaces of indentation", () => {
  const lists = listScanner.scanLines(["- [ ] a", "\t- [ ] b", "    - [ ] c"]);
  assert.equal(lists.length, 2);
  assert.equal(lists[1].total, 2);
});

test("non-checkbox lines end all open lists", () => {
  const lists = listScanner.scanLines(["- [ ] a", "text", "  - [ ] b"]);
  assert.deepEqual(
    lists.map((l) => l.depth),
    [0, 0],
  );
});

test("listMarkdown strips the list's indentation and includes sub-lists", () => {
  const lines = ["  - [ ] a", "    - [x] b", "  - [x] c"];
  const [outer] = listScanner.scanLines(lines);
  assert.equal(
    listScanner.listMarkdown(lines, outer),
    "- [ ] a\n  - [x] b\n- [x] c",
  );
});

// The rich text editor's copy rebuilds the Markdown with "- " and two spaces
// per nesting level; the Markdown editors' copy must give the same result.
test("listMarkdown indents nested items by two spaces per level, like the rich text copy", () => {
  const lines = [
    "* [ ] AI Experts search",
    "    * [ ] Informationen von Oana",
    "        - [x] deeper",
    "    * [ ] Challenge",
    "      continuation of Challenge  ",
    "",
    "* [x] next",
  ];
  const [outer] = listScanner.scanLines(lines);
  assert.equal(
    listScanner.listMarkdown(lines, outer),
    [
      "- [ ] AI Experts search",
      "  - [ ] Informationen von Oana",
      "    - [x] deeper",
      "  - [ ] Challenge",
      "    continuation of Challenge  ",
      "",
      "- [x] next",
    ].join("\n"),
  );
});

const ids = (lines: string[]) =>
  listScanner.scanLines(lines).map((l) => [l.listId, l.done, l.total, l.depth]);

test("upper-case X and empty items count as checkbox items", () => {
  assert.deepEqual(ids(["- [X] done", "- [ ]", "- [x]"]), [
    ["list-0", 2, 3, 0],
  ]);
});

test("a bracket without a following space is text, so the list is no Checklist", () => {
  assert.deepEqual(ids(["- [x]text", "- [ ] b"]), []);
});

test("ordered lists and lists in block quotes are not Checklists", () => {
  assert.deepEqual(ids(["1. [ ] a", "2. [x] b", "", "> - [ ] quoted"]), []);
});

test("a heading directly above a list ends nothing and starts nothing", () => {
  assert.deepEqual(
    ids(["## General", "- [x] a", "", "### Person", "- [ ] b"]),
    [
      ["list-0", 1, 1, 0],
      ["list-1", 0, 1, 0],
    ],
  );
});

test("a thematic break neither is a Checklist nor takes a List ID", () => {
  assert.deepEqual(ids(["- [ ] a", "", "* * *", "", "- [x] b"]), [
    ["list-0", 0, 1, 0],
    ["list-1", 1, 1, 0],
  ]);
});

test("Windows line endings are handled", () => {
  const lines = ["- [x] a\r", "- [ ] b\r"];
  assert.deepEqual(ids(lines), [["list-0", 1, 2, 0]]);
  const [list] = listScanner.scanLines(lines);
  assert.equal(listScanner.listMarkdown(lines, list), "- [x] a\n- [ ] b");
});

test("inserting a Checklist above another shifts the latter's List ID", () => {
  assert.deepEqual(ids(["- [ ] b"])[0][0], "list-0");
  assert.deepEqual(ids(["- [ ] a", "", "Text", "", "- [ ] b"])[1][0], "list-1");
});

test("parents, item lines and done lines are reported per Checklist", () => {
  const [outer, middle, inner] = listScanner.scanLines([
    "- [ ] a",
    "    - [x] b",
    "        - [x] c",
    "        - [ ] d",
    "    - [ ] e",
  ]);
  assert.deepEqual(outer.parentIds, []);
  assert.deepEqual(middle.parentIds, ["list-0"]);
  assert.deepEqual(inner.parentIds, ["list-0", "list-1"]);
  assert.deepEqual(middle.itemLines, [1, 4]);
  assert.deepEqual(middle.doneLines, [1]);
  assert.deepEqual(inner.itemLines, [2, 3]);
  assert.deepEqual([outer.startLine, outer.endLine], [0, 4]);
});

test("a Checklist nested in a plain list has no enclosing Checklist", () => {
  const [list] = listScanner.scanLines(["- plain", "  - [x] a"]);
  assert.equal(list.depth, 1);
  assert.deepEqual(list.parentIds, []);
});

test("listMarkdown writes '-' bullets and two spaces per level for every marker and tabs", () => {
  const lines = ["+ [ ] a", "\t+ [x] b", "\t\t+ [ ] c", "+ [ ]"];
  const [outer] = listScanner.scanLines(lines);
  assert.equal(
    listScanner.listMarkdown(lines, outer),
    "- [ ] a\n  - [x] b\n    - [ ] c\n- [ ]",
  );
});

test("listMarkdown of a nested Checklist starts at column zero", () => {
  const lines = ["- [ ] a", "    - [x] b", "        - [ ] c"];
  const [, nested] = listScanner.scanLines(lines);
  assert.equal(listScanner.listMarkdown(lines, nested), "- [x] b\n  - [ ] c");
});

test("listMarkdown keeps fenced code inside an item at its indentation relative to the item's text", () => {
  const lines = [
    "- [ ] a",
    "    ```",
    "    - [ ] not an item",
    "      indented code",
    "    ```",
    "- [x] b",
  ];
  const [list] = listScanner.scanLines(lines);
  assert.equal(list.total, 2);
  assert.equal(
    listScanner.listMarkdown(lines, list),
    "- [ ] a\n    ```\n    - [ ] not an item\n      indented code\n    ```\n- [x] b",
  );
});
