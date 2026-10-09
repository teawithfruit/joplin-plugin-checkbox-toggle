import { expect, test, type Page } from "@playwright/test";

// The preview (Joplin's note viewer) with Joplin's checkbox markup and styles.
const NOTE = [
  "## General",
  "- [x] done item",
  "- [ ] open item",
  "    - [x] nested done",
  "    - [ ] nested open",
  "",
  "Text",
  "",
  "* [ ] other",
].join("\n");

async function mount(page: Page, hidden: string[] = []) {
  await page.goto(new URL("./fixtures/preview.html", import.meta.url).href);
  await page.evaluate(
    ([note, lists]) => {
      window.copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (value: string) => void window.copied.push(value),
        },
      });
      return window.mountPreview(note, lists);
    },
    [NOTE, hidden] as const,
  );
}

// The list item with this text (not the items it is nested in).
const item = (page: Page, text: string) =>
  page.locator("li:not(:has(li))", { hasText: text });

async function barsAndCheckboxes(page: Page) {
  return page.locator(".chx-btn-block").evaluateAll((bars) =>
    bars.map((bar) => {
      const item = bar.nextElementSibling!.querySelector(":scope > li")!;
      return {
        bar: bar.querySelector(".chx-toolbar")!.getBoundingClientRect().left,
        checkbox: item.querySelector("input")!.getBoundingClientRect().left,
      };
    }),
  );
}

test("bars start where their list's checkbox is drawn", async ({ page }) => {
  await mount(page);
  const positions = await barsAndCheckboxes(page);
  expect(positions).toHaveLength(3);
  for (const { bar, checkbox } of positions)
    expect(bar).toBeCloseTo(checkbox, 0);
});

test("the toolbar is only as wide as its buttons", async ({ page }) => {
  await mount(page);
  const toolbar = (await page.locator(".chx-toolbar").first().boundingBox())!;
  const buttons = await page
    .locator(".chx-toolbar")
    .first()
    .locator("button")
    .evaluateAll((all) =>
      all.reduce((sum, b) => sum + b.getBoundingClientRect().width, 0),
    );
  expect(toolbar.width).toBeLessThan(buttons + 10);
});

test("toggling hides Done items, nested ones too, and stores the Hide State", async ({
  page,
}) => {
  await mount(page);
  await page.locator("button.chx-toggle").first().click();
  await expect(item(page, "done item")).toBeHidden();
  await expect(item(page, "nested done")).toBeHidden();
  await expect(item(page, "nested open")).toBeVisible();
  expect(await page.evaluate(() => window.pluginMessages.at(-1))).toEqual({
    type: "setState",
    noteId: "note-1",
    listId: "list-0",
    hideDone: true,
  });
  await page.locator("button.chx-toggle").first().click();
  await expect(item(page, "done item")).toBeVisible();
});

test("ticking an item updates the count and hides it in a hidden list", async ({
  page,
}) => {
  await mount(page, ["list-1"]);
  await expect(page.locator(".chx-count").nth(1)).toHaveText("1 / 2");
  await item(page, "nested open").locator("input").click();
  await expect(page.locator(".chx-count").nth(1)).toHaveText("2 / 2");
  await expect(item(page, "nested open")).toBeHidden();
});

test("a bar keeps its place when all of its Checklist's items are hidden", async ({
  page,
}) => {
  await mount(page);
  const before = (await barsAndCheckboxes(page))[1].bar;
  await item(page, "nested open").locator("input").click();
  await page.locator("button.chx-toggle").nth(1).click();
  await expect(item(page, "nested open")).toBeHidden();
  const after = await page
    .locator(".chx-toolbar")
    .nth(1)
    .evaluate((toolbar) => toolbar.getBoundingClientRect().left);
  expect(after).toBeCloseTo(before, 0);
});

test("copy puts the Checklist's Markdown on the clipboard", async ({
  page,
}) => {
  await mount(page);
  await page.locator("button.chx-copy").first().click();
  expect(await page.evaluate(() => window.copied)).toEqual([
    "- [x] done item\n- [ ] open item\n  - [x] nested done\n  - [ ] nested open",
  ]);
});
