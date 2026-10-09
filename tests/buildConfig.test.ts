import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";

// Wiring between the sources, the build config and the plugin entry: a
// mismatch here builds without errors but breaks the plugin in Joplin.
const root = (path: string) =>
  fileURLToPath(new URL("../" + path, import.meta.url));
const read = (path: string) => readFileSync(root(path), "utf8");

const extraScripts: string[] = JSON.parse(
  read("plugin.config.json"),
).extraScripts;
const built = (script: string) => "./" + script.replace(/\.ts$/, ".js");

test("every extra script in plugin.config.json exists in src", () => {
  for (const script of extraScripts) {
    assert.ok(existsSync(root("src/" + script)), `src/${script} is missing`);
  }
});

test("the plugin registers exactly the built content scripts", () => {
  const index = read("src/index.ts");
  const registered = Array.from(
    index.matchAll(/"(\.\/[\w]+\.js)"/g),
    (m) => m[1],
  );
  assert.deepEqual(
    registered.sort(),
    extraScripts
      .filter((script) => script !== "checkboxRendererBrowser.ts")
      .map(built)
      .sort(),
  );
});

test("the webview script is built as a plain browser script and loaded as an asset", () => {
  assert.ok(extraScripts.includes("checkboxRendererBrowser.ts"));
  assert.match(
    read("webpack.config.cjs"),
    /const browserScripts = \['checkboxRendererBrowser\.ts'\];/,
  );
  const assets = createCheckboxRenderer({ contentScriptId: "test" })
    .assets({})
    .map((asset) => asset.name);
  assert.ok(assets.includes("checkboxRendererBrowser.js"));
});

test("the webview script posts to the renderer's content script ID", () => {
  const id = read("src/index.ts").match(/MARKDOWN_SCRIPT_ID = "(\w+)"/)![1];
  assert.match(read("src/checkboxRendererBrowser.ts"), new RegExp(`"${id}"`));
});

test("package.json and manifest.json agree on the version", () => {
  assert.equal(
    JSON.parse(read("package.json")).version,
    JSON.parse(read("src/manifest.json")).version,
  );
});
