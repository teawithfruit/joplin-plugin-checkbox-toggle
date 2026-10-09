import { expect, test, type Page } from "@playwright/test";

// The rich text editor: TinyMCE configured like Joplin's, with the plugin's
// rendering and the webview script loaded into the editor.
const NOTE = [
  "## General",
  "- [x] done item",
  "- [ ] **Important** see [docs](https://example.com/a+b)",
  "- [ ] search",
  "    - [ ] nested one",
  "    - [x] nested two",
  "",
  "### Person",
  "- [x] brochure",
  "    - [x] slides",
  "",
  "After",
].join("\n");

async function mount(page: Page, hidden: string[] = []) {
  await page.goto(new URL("./fixtures/richText.html", import.meta.url).href);
  await page.evaluate(([note, lists]) => window.mountRichText(note, lists), [
    NOTE,
    hidden,
  ] as const);
}

const editor = (page: Page) => page.frameLocator("iframe");

async function mouseOn(
  page: Page,
  selector: string,
  index = 0,
  double = false,
) {
  const element = editor(page).locator(selector).nth(index);
  const box = (await element.boundingBox())!;
  const x = box.x + Math.min(box.width / 2, 20);
  const y = box.y + box.height / 2;
  if (double) await page.mouse.dblclick(x, y);
  else await page.mouse.click(x, y);
  await page.waitForTimeout(100);
}

const selectedByEditor = (page: Page) =>
  editor(page).locator("[data-mce-selected]").count();
const takeLog = (
  page: Page,
  name: "saveTriggers" | "joplinCopies" | "copiedText",
) => page.evaluate((key) => window[key].splice(0), name);

test("exactly one bar per Checklist; top-level bars stay blocks outside paragraphs", async ({
  page,
}) => {
  await mount(page);
  const bars = await editor(page)
    .locator(".chx-btn-block")
    .evaluateAll((elements) =>
      elements.map((bar) => [
        bar.tagName,
        bar.parentElement!.tagName,
        bar.nextElementSibling!.tagName,
        bar.querySelector(".chx-toggle")!.getAttribute("data-chx-list"),
      ]),
    );
  expect(bars).toEqual([
    ["DIV", "BODY", "UL", "list-0"],
    ["SPAN", "LI", "UL", "list-1"],
    ["DIV", "BODY", "UL", "list-2"],
    ["SPAN", "LI", "UL", "list-3"],
  ]);
});

test("pressing a bar's buttons neither selects the bar nor makes Joplin save", async ({
  page,
}) => {
  await mount(page);
  await takeLog(page, "saveTriggers");
  await mouseOn(page, "button.chx-toggle", 0);
  await mouseOn(page, "button.chx-toggle", 0);
  await mouseOn(page, "button.chx-toggle", 1);
  await mouseOn(page, "button.chx-copy", 0);
  await mouseOn(page, "button.chx-toggle", 2, true);
  await mouseOn(page, ".chx-btn-block", 0);
  expect(await selectedByEditor(page)).toBe(0);
  expect(await takeLog(page, "saveTriggers")).toEqual([]);
  expect(await takeLog(page, "joplinCopies")).toEqual([]);

  // Control: real editing does make Joplin save.
  await mouseOn(page, "p", 0);
  await page.keyboard.type("x");
  await page.keyboard.press("Enter");
  expect(await takeLog(page, "saveTriggers")).toEqual([
    "keypress",
    "keyup Enter",
  ]);
});

test("copy puts the Checklist's Markdown on the clipboard, not the bar's text", async ({
  page,
}) => {
  await mount(page);
  await mouseOn(page, "button.chx-copy", 0);
  await mouseOn(page, "button.chx-copy", 1);
  expect(await takeLog(page, "copiedText")).toEqual([
    "- [x] done item\n" +
      "- [ ] **Important** see [docs](https://example.com/a+b)\n" +
      "- [ ] search\n" +
      "  - [ ] nested one\n" +
      "  - [x] nested two",
    "- [ ] nested one\n- [x] nested two",
  ]);
  expect(await takeLog(page, "joplinCopies")).toEqual([]);
});

test("copy takes ticks made in the editor into account", async ({ page }) => {
  await mount(page);
  await editor(page)
    .locator("ul.joplin-checklist")
    .nth(1)
    .locator("li")
    .first()
    .evaluate((item) => item.classList.add("checked"));
  await page.waitForTimeout(50);
  await mouseOn(page, "button.chx-copy", 1);
  expect(await takeLog(page, "copiedText")).toEqual([
    "- [x] nested one\n- [x] nested two",
  ]);
  await expect(editor(page).locator(".chx-count").nth(1)).toHaveText("2 / 2");
});

test("toggling hides and shows Done items and stores the Hide State", async ({
  page,
}) => {
  await mount(page);
  const doneItem = editor(page).locator("li.checked").first();
  await expect(doneItem).toBeVisible();
  await mouseOn(page, "button.chx-toggle", 0);
  await expect(doneItem).toBeHidden();
  await expect(
    editor(page).locator("button.chx-toggle").first(),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.pluginMessages.at(-1))).toEqual({
    type: "setState",
    noteId: "note-1",
    listId: "list-0",
    hideDone: true,
  });
  await mouseOn(page, "button.chx-toggle", 0);
  await expect(doneItem).toBeVisible();
});

test("a stored Hide State is applied when the note opens", async ({ page }) => {
  await mount(page, ["list-2"]);
  await expect(
    editor(page).locator("li.checked", { hasText: "brochure" }),
  ).toBeHidden();
  await expect(
    editor(page).locator("li.checked", { hasText: "done item" }),
  ).toBeVisible();
});

// Joplin's checkbox is an absolutely positioned li::before without a box of
// its own; a real element with the same style marks where it is drawn.
async function barsAndCheckboxes(page: Page) {
  return editor(page)
    .locator(".chx-btn-block")
    .evaluateAll((bars) =>
      bars.map((bar) => {
        const item = bar.nextElementSibling!.querySelector(":scope > li")!;
        if (!item.getClientRects().length) return null;
        const probe = document.createElement("span");
        probe.style.cssText =
          "position:absolute;width:1em;height:1em;margin-left:-1.3em";
        item.insertBefore(probe, item.firstChild);
        const checkbox = probe.getBoundingClientRect().left;
        probe.remove();
        return {
          bar: bar.querySelector(".chx-toolbar")!.getBoundingClientRect().left,
          checkbox,
        };
      }),
    );
}

test("bars start where their list's checkbox is drawn", async ({ page }) => {
  await mount(page);
  for (const position of await barsAndCheckboxes(page)) {
    expect(position!.bar).toBeCloseTo(position!.checkbox, 0);
  }
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForTimeout(200);
  for (const position of await barsAndCheckboxes(page)) {
    expect(position!.bar).toBeCloseTo(position!.checkbox, 0);
  }
});

test("a bar keeps its place when all of its Checklist's items are hidden", async ({
  page,
}) => {
  await mount(page);
  const before = await editor(page)
    .locator("button.chx-toggle")
    .nth(2)
    .evaluate((button) => button.getBoundingClientRect().left);
  await mouseOn(page, "button.chx-toggle", 2);
  await expect(
    editor(page).locator("li.checked", { hasText: "brochure" }),
  ).toBeHidden();
  const after = await editor(page)
    .locator("button.chx-toggle")
    .nth(2)
    .evaluate((button) => button.getBoundingClientRect().left);
  expect(after).toBeCloseTo(before, 1);
});
