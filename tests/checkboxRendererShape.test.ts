import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";

// Regression guard: Joplin's MarkdownItPlugin content-script contract requires
// a single top-level default(context) export that returns an object with a
// "plugin" function. Prior versions exported "markdownItPlugin" instead (so
// the rule silently never ran), and separately wrapped the export in an extra
// { default: fn } object (so Joplin's require(path).default(context) call
// would have received an object, not a function, and crashed).
test("content script exports the plugin/assets shape Joplin's MarkdownItPlugin contract requires", () => {
  assert.strictEqual(typeof createCheckboxRenderer, "function");
  const instance = createCheckboxRenderer({ contentScriptId: "test" });

  assert.strictEqual(typeof instance.plugin, "function");
  assert.strictEqual(typeof instance.assets, "function");

  const assets = instance.assets({});
  const names = assets.map((asset) => asset.name);

  // Click handling runs in the browser/webview, loaded as a plain <script>
  // asset; the legacy "chx-logic.js" duplicate must not be referenced.
  assert.ok(
    names.includes("checkboxRendererBrowser.js"),
    "assets() must list checkboxRendererBrowser.js",
  );
  assert.ok(
    !names.includes("chx-logic.js"),
    "assets() must not reference the removed chx-logic.js",
  );
});

test("plugin inserts a Button bar right before each Checklist", () => {
  const md = new MarkdownIt();
  createCheckboxRenderer({ contentScriptId: "test" }).plugin(md, {
    noteId: "note-1",
  });
  const html = md.render("- [x] a\n- [ ] b\n");

  assert.match(html, /data-chx-note="note-1"/);
  assert.match(html, /1 \/ 2/);
  assert.match(
    html,
    /<\/div><\/div><ul class="chx-list" data-chx-list="list-0"/,
  );
});

// Regression guard: the toolbar is a flex container, so without a width it
// stretches across the whole preview instead of hugging its buttons.
test("rendered toolbar is only as wide as its buttons", () => {
  const instance = createCheckboxRenderer({ contentScriptId: "test" });
  const css =
    instance.assets({}).find((asset) => asset.name === "chx-style")?.text ?? "";
  const toolbarRule = /\.chx-toolbar \{([^}]*)\}/.exec(css)?.[1] ?? "";

  assert.match(toolbarRule, /width: fit-content;/);
});
