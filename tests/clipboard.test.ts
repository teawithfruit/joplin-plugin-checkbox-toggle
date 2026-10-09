import assert from "node:assert/strict";
import { test } from "node:test";
import clipboard from "../src/clipboard.ts";

// Regression guard: clipboard.ts is imported by contentScript.ts,
// contentScriptCm5.ts and checkboxRenderer.ts (all bundled via webpack), and
// its logic is duplicated inline in checkboxRendererBrowser.ts, which must
// stay dependency-free. Pin its exported shape so neither consumer silently
// receives undefined helpers.
test("clipboard module exports copyToClipboard, flashCopied and icon markup", () => {
  assert.strictEqual(typeof clipboard.copyToClipboard, "function");
  assert.strictEqual(typeof clipboard.flashCopied, "function");
  assert.match(clipboard.COPY_ICON, /<svg/);
  assert.match(clipboard.CHECK_ICON, /<svg/);
});

test("copyToClipboard uses navigator.clipboard.writeText when available", async () => {
  const written: string[] = [];
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  Object.defineProperty(globalThis, "navigator", {
    value: {
      clipboard: {
        writeText: (text: string) => {
          written.push(text);
          return Promise.resolve();
        },
      },
    },
    configurable: true,
  });
  try {
    await clipboard.copyToClipboard("- [ ] task");
    assert.deepEqual(written, ["- [ ] task"]);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "navigator", originalDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  }
});

test("flashCopied swaps a button's icon to a checkmark and back", () => {
  let html = "";
  const button = {
    set innerHTML(value) {
      html = value;
    },
    get innerHTML() {
      return html;
    },
  };
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) =>
    fn()) as unknown as typeof setTimeout;
  try {
    clipboard.flashCopied(button);
    assert.strictEqual(html, clipboard.COPY_ICON);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

// Without the async Clipboard API (blocked in Joplin's rich text editor), the
// text goes into the "copy" event that execCommand("copy") fires. It must be
// set there and stopped, because the rich text editor would otherwise copy
// its own selection over it.
test("without the Clipboard API, the copy event carries the text and stops there", async () => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<body></body>");
  const reachedEditor: string[] = [];
  dom.window.document.body.addEventListener("copy", () =>
    reachedEditor.push("copy"),
  );
  const data: Record<string, string> = {};
  dom.window.document.execCommand = ((command: string) => {
    assert.equal(command, "copy");
    const event = new dom.window.Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (type: string, value: string) => (data[type] = value) },
    });
    dom.window.document.body.dispatchEvent(event);
    return true;
  }) as typeof dom.window.document.execCommand;

  const originals = {
    window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    document: Object.getOwnPropertyDescriptor(globalThis, "document"),
    navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
  };
  Object.defineProperty(globalThis, "window", {
    value: dom.window,
    configurable: true,
  });
  Object.defineProperty(globalThis, "document", {
    value: dom.window.document,
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
  });
  try {
    await clipboard.copyToClipboard("- [ ] task");
  } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }

  assert.deepEqual(data, { "text/plain": "- [ ] task" });
  assert.deepEqual(reachedEditor, []);
});
