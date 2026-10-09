import assert from "node:assert/strict";
import { test } from "node:test";
import locale from "../src/locale.ts";

// Regression guard: the toggle button's label must be German when the host
// language is German, English otherwise (there is no navigator in this test
// environment, so detectLanguage() must default to English rather than throw).
test("locale defaults to English when navigator is unavailable", () => {
  assert.strictEqual(locale.detectLanguage(), "en");
  assert.strictEqual(locale.t("hide"), "Hide completed");
  assert.strictEqual(locale.t("show"), "Show completed");
  assert.strictEqual(locale.t("ariaToggle"), "Show or hide completed tasks");
});

test("locale switches to German when navigator.language is German", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { language: "de-DE" },
    configurable: true,
  });
  try {
    assert.strictEqual(locale.detectLanguage(), "de");
    assert.strictEqual(locale.t("hide"), "Erledigte ausblenden");
    assert.strictEqual(locale.t("show"), "Erledigte einblenden");
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "navigator", descriptor);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  }
});
