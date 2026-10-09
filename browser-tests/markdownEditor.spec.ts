import { expect, test, type Page } from "@playwright/test";

// The Markdown editor (CodeMirror 6) in a real browser: click accuracy and
// Button bar placement need layout, which jsdom does not have.
const NOTE = [
  "# Title",
  "- [ ] one",
  "- [x] two",
  "    - [x] nested a",
  "    - [x] nested b",
  "- [ ] three",
  "",
  "Text between",
  "",
  "* [x] four",
  "* [ ] five",
  "    - [ ] deep",
  "        - [x] deeper",
  "End",
].join("\n");

type Options = { joplinLike?: boolean; hidden?: string[] };

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTimeout(resolve, 20)),
        ),
      ),
  );
}

async function mount(page: Page, options: Options = {}, doc = NOTE) {
  await page.goto(new URL("./fixtures/cm6.html", import.meta.url).href);
  await page.evaluate(
    ([text, opts]) => {
      window.copied = [];
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (value: string) => void window.copied.push(value),
        },
      });
      window.mountEditor(text, opts);
    },
    [doc, options] as const,
  );
  await settle(page);
}

// Clicks the middle of every visible line and reports where the cursor went.
async function misplacedClicks(page: Page): Promise<string[]> {
  const wrong: string[] = [];
  for (const line of await page.locator(".cm-line").all()) {
    const box = await line.boundingBox();
    if (!box || box.height < 2) continue;
    await page.mouse.click(box.x + box.width - 5, box.y + box.height / 2);
    const [clicked, landed] = await line.evaluate((element) => {
      const view = window.view;
      const clickedLine = view.state.doc.lineAt(view.posAtDOM(element)).number;
      return [
        clickedLine,
        view.state.doc.lineAt(view.state.selection.main.head).number,
      ];
    });
    if (clicked !== landed) wrong.push(`line ${clicked} -> ${landed}`);
  }
  return wrong;
}

// For every bar: its left edge and where its list's first item is drawn
// (Joplin's checkbox widget, or the bullet character).
async function barPositions(page: Page) {
  return page.evaluate(() => {
    const view = window.view;
    return Array.from(
      document.querySelectorAll<HTMLElement>(".chx-cm-widget"),
    ).map((widget) => {
      const listId = widget
        .querySelector(".chx-cm-toggle")!
        .getAttribute("data-chx-list");
      const line = view.state.doc.lineAt(view.posAtDOM(widget));
      const found = view.domAtPos(line.from).node;
      const lineElement = (
        found.nodeType === 1 ? (found as Element) : found.parentElement
      )!.closest(".cm-line")!;
      const checkbox = lineElement.querySelector(".joplin-like-checkbox");
      let bullet: number;
      if (checkbox) {
        bullet = checkbox.getBoundingClientRect().left;
      } else {
        const range = document.createRange();
        const indent = line.text.length - line.text.trimStart().length;
        const start = view.domAtPos(line.from + indent);
        range.setStart(start.node, start.offset);
        range.setEnd(start.node, start.offset + 1);
        bullet = range.getBoundingClientRect().left;
      }
      const bar = widget
        .querySelector(".chx-cm-toolbar")!
        .getBoundingClientRect().left;
      return {
        listId,
        bar: Math.round(bar * 10) / 10,
        bullet: Math.round(bullet * 10) / 10,
      };
    });
  });
}

async function clickToggle(page: Page, listId: string) {
  await page.locator(`.chx-cm-toggle[data-chx-list="${listId}"]`).click();
  await settle(page);
}

for (const joplinLike of [false, true]) {
  const rendering = joplinLike ? "Joplin-like rendering" : "plain text";

  test.describe(`Markdown editor, ${rendering}`, () => {
    test("every click puts the cursor on the clicked line", async ({
      page,
    }) => {
      await mount(page, { joplinLike });
      expect(await page.locator(".chx-cm-widget").count()).toBe(5);
      expect(await misplacedClicks(page)).toEqual([]);
    });

    test("clicks stay accurate with hidden Done items", async ({ page }) => {
      await mount(page, { joplinLike, hidden: ["list-0", "list-2"] });
      expect(await misplacedClicks(page)).toEqual([]);
      await clickToggle(page, "list-0");
      expect(await misplacedClicks(page)).toEqual([]);
    });

    test("every bar starts where its list's bullet is drawn", async ({
      page,
    }) => {
      await mount(page, { joplinLike });
      for (const { listId, bar, bullet } of await barPositions(page)) {
        expect(bar, listId!).toBeCloseTo(bullet, 0);
      }
    });

    test("a fully hidden nested Checklist keeps its bar on its level", async ({
      page,
    }) => {
      await mount(page, { joplinLike });
      const before = (await barPositions(page))[1];
      await clickToggle(page, "list-1");
      expect(await page.locator(".chx-cm-done-hidden").count()).toBe(2);
      expect((await barPositions(page))[1].bar).toBeCloseTo(before.bar, 0);
      await clickToggle(page, "list-0");
      expect((await barPositions(page))[1].bar).toBeCloseTo(before.bar, 0);
      await clickToggle(page, "list-1");
      await clickToggle(page, "list-0");
      expect((await barPositions(page))[1].bar).toBeCloseTo(before.bar, 0);
    });

    test("a note loaded with hidden Checklists has its bars in place", async ({
      page,
    }) => {
      await mount(page, { joplinLike });
      const shown = await barPositions(page);
      await mount(page, { joplinLike, hidden: ["list-0", "list-1"] });
      expect((await barPositions(page)).map((p) => p.bar)).toEqual(
        shown.map((p) => p.bar),
      );
    });

    test("bars follow edits, including new nested Checklists", async ({
      page,
    }) => {
      await mount(page, { joplinLike });
      await page.evaluate(() => {
        const view = window.view;
        view.dispatch({
          changes: {
            from: view.state.doc.length,
            insert:
              "\n\n- [ ] new\n    - [x] new nested\n        - [ ] new deeper",
          },
        });
      });
      await settle(page);
      const positions = await barPositions(page);
      expect(positions).toHaveLength(8);
      for (const { listId, bar, bullet } of positions) {
        expect(bar, listId!).toBeCloseTo(bullet, 0);
      }
      expect(await misplacedClicks(page)).toEqual([]);
    });

    test("hidden Done items take no space and cannot be seen", async ({
      page,
    }) => {
      await mount(page, { joplinLike, hidden: ["list-0"] });
      const hidden = page.locator(".chx-cm-done-hidden");
      expect(await hidden.count()).toBe(3);
      for (const line of await hidden.all()) {
        expect((await line.boundingBox())?.height ?? 0).toBe(0);
        await expect(line).toBeHidden();
      }
    });
  });
}

test("copy puts the Checklist's Markdown on the clipboard", async ({
  page,
}) => {
  await mount(page);
  await page.locator('.chx-cm-copy[data-chx-list="list-2"]').click();
  expect(await page.evaluate(() => window.copied)).toEqual([
    "- [x] four\n- [ ] five\n  - [ ] deep\n    - [x] deeper",
  ]);
});

test("the toggle shows and hides Done items and stores the Hide State", async ({
  page,
}) => {
  await mount(page);
  await clickToggle(page, "list-2");
  await expect(page.locator(".chx-cm-done-hidden")).toHaveCount(2);
  await expect(
    page.locator('.chx-cm-toggle[data-chx-list="list-2"]'),
  ).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.pluginMessages.at(-1))).toEqual({
    type: "setState",
    noteId: "note-1",
    listId: "list-2",
    hideDone: true,
  });
  await clickToggle(page, "list-2");
  await expect(page.locator(".chx-cm-done-hidden")).toHaveCount(0);
});
