// ============================================================================
// CheckboxHide - checkboxRendererBrowser.ts
// ============================================================================
// Browser-side companion to checkboxRenderer.ts. Joplin loads the built
// checkboxRendererBrowser.js as a plain <script> tag in the preview pane /
// rich text editor webview (it is listed by name in checkboxRenderer_.assets()),
// so webpack bundles it without a CommonJS wrapper (see browserScripts in
// webpack.config.cjs). It keeps its own copies of the locale and clipboard
// logic and only imports types.
//
// Behavior:
// - Finds all .chx-btn-block buttons
// - On load: reads per-list state via webviewApi.postMessage and applies hide class
// - On click: toggles one list, updates its button, and persists its state
// ============================================================================

import type { ListId } from "./types.ts";
import type {
  GetStateMessage,
  PluginMessage,
  PluginResponse,
  SetStateMessage,
} from "./messages.ts";

declare global {
  interface Window {
    webviewApi?: {
      postMessage(
        contentScriptId: string,
        message: PluginMessage,
      ): Promise<PluginResponse>;
    };
  }
}

type StringKey = "hide" | "show" | "copyAria";

(function () {
  "use strict";

  // Dependency-free copy of locale.ts's detection logic.
  const STRINGS: Record<"en" | "de", Record<StringKey, string>> = {
    en: {
      hide: "Hide completed",
      show: "Show completed",
      copyAria: "Copy checklist as Markdown",
    },
    de: {
      hide: "Erledigte ausblenden",
      show: "Erledigte einblenden",
      copyAria: "Checkliste als Markdown kopieren",
    },
  };
  function t(key: StringKey): string {
    const language =
      (typeof navigator !== "undefined" && navigator.language) || "";
    const lang = language.toLowerCase().indexOf("de") === 0 ? "de" : "en";
    return STRINGS[lang][key];
  }

  // Dependency-free copy of clipboard.ts's logic.
  const COPY_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  const CHECK_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="20 6 9 17 4 12"></polyline></svg>';

  // Puts the text into the "copy" event that execCommand("copy") fires.
  // Listening on the window in the capture phase runs before any editor's own
  // copy handling (the rich text editor copies its current selection), and
  // stopping the event keeps those handlers from overwriting the text.
  function fallbackCopy(text: string): void {
    if (typeof window === "undefined" || typeof document === "undefined")
      return;
    const onCopy = function (event: ClipboardEvent): void {
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("copy", onCopy, true);
    try {
      // execCommand("copy") does nothing in a document without focus, e.g. the
      // rich text editor when the copy button is the first thing clicked (the
      // bar keeps presses from focusing the editor).
      if (!document.hasFocus()) window.focus();
      document.execCommand("copy");
    } catch (error) {
      console.warn("CheckboxHide: fallback clipboard copy failed:", error);
    } finally {
      window.removeEventListener("copy", onCopy, true);
    }
  }

  function copyToClipboard(text: string): Promise<void> {
    if (
      typeof navigator !== "undefined" &&
      navigator.clipboard &&
      navigator.clipboard.writeText
    ) {
      return navigator.clipboard.writeText(text).catch(function () {
        fallbackCopy(text);
      });
    }
    fallbackCopy(text);
    return Promise.resolve();
  }

  function flashCopied(button: Element | null): void {
    if (!button) return;
    button.innerHTML = CHECK_ICON;
    setTimeout(function () {
      button.innerHTML = COPY_ICON;
    }, 1200);
  }

  // Reconstructs markdown checkbox syntax ("- [ ] text" / "- [x] text") from
  // a rendered <ul>, recursing into nested <ul>s so a parent's copy includes
  // its whole subtree, indented 2 spaces per nesting level.
  function markdownFromList(list: Element, depth: number): string[] {
    let lines: string[] = [];
    const items = Array.from(list.children).filter(function (item) {
      return item.tagName === "LI";
    });
    items.forEach(function (item) {
      const input = item.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      const isDone =
        item.classList.contains("checked") ||
        item.classList.contains("chx-done") ||
        (input &&
          input.closest("li") === item &&
          (input.checked || input.hasAttribute("checked")));

      const clone = item.cloneNode(true) as Element;
      const nestedList = clone.querySelector("ul");
      if (nestedList) nestedList.remove();
      // A nested Checklist's Button bar sits inside its parent item.
      clone.querySelectorAll(".chx-btn-block").forEach(function (bar) {
        bar.remove();
      });
      const cloneInput = clone.querySelector('input[type="checkbox"]');
      if (cloneInput) cloneInput.remove();
      const text = (clone.textContent || "").replace(/\s+/g, " ").trim();

      const indent = new Array(depth + 1).join("  ");
      lines.push(indent + "- [" + (isDone ? "x" : " ") + "] " + text);

      const childList = item.querySelector("ul");
      if (childList) {
        lines = lines.concat(markdownFromList(childList, depth + 1));
      }
    });
    return lines;
  }

  function postState(
    message: GetStateMessage | SetStateMessage,
  ): Promise<Pick<PluginResponse, "hideDone">> {
    if (!window.webviewApi) return Promise.resolve({ hideDone: false });
    return window.webviewApi.postMessage("checkboxHideMarkdown", message);
  }

  function updateButton(button: Element, hideDone: boolean): void {
    const action = button.querySelector(".chx-action");
    if (action) {
      action.textContent = hideDone ? t("show") : t("hide");
    }
    button.setAttribute("aria-pressed", String(hideDone));
    button.classList.toggle("chx-hidden", hideDone);
  }

  // Buttons carry the List ID that checkboxRenderer.ts or
  // insertMissingButtons() wrote into data-chx-list.
  function readListId(button: Element): ListId | "" {
    return (button.getAttribute("data-chx-list") || "") as ListId | "";
  }

  // Toggle button click handler
  function toggleClick(event: Event): void {
    const button = event.currentTarget as Element;
    const wrapper = button.closest(".chx-btn-block");
    if (!wrapper) return;

    // Find the associated list (our sibling after the wrapper)
    const list = wrapper.nextElementSibling;
    if (!list) return;

    // Determine current hidden state from the list's class
    const isHidden = list.classList.contains("chx-done-hidden");
    const newIsHidden = !isHidden;

    // Toggle the list's hide class
    if (newIsHidden) {
      list.classList.add("chx-done-hidden");
    } else {
      list.classList.remove("chx-done-hidden");
    }
    updateButton(button, newIsHidden);

    // Post state change
    const noteId = button.getAttribute("data-chx-note") || "";
    const listId = readListId(button);
    postState({
      type: "setState",
      noteId: noteId,
      listId: listId,
      hideDone: newIsHidden,
    }).catch(function (error) {
      console.warn("CheckboxHide: could not save renderer state:", error);
    });
  }

  // Copy button click handler: reconstructs the list's (and nested lists')
  // markdown checkbox syntax from the rendered DOM and copies it.
  function copyClick(event: Event): void {
    const button = event.currentTarget as Element;
    const wrapper = button.closest(".chx-btn-block");
    if (!wrapper) return;

    const list = wrapper.nextElementSibling;
    if (!list) return;

    const rendered = button.getAttribute("data-chx-markdown");
    const markdown =
      (rendered !== null && withCurrentMarks(rendered, list)) ||
      markdownFromList(list, 0).join("\n");
    copyToClipboard(markdown);
    flashCopied(button);
  }

  // The renderer gives each copy button its Checklist's Markdown, exactly as
  // the Markdown editors copy it. The rich text editor may have ticked boxes
  // since, so the marks come from the page; if items were added or removed
  // there, the Markdown no longer fits and null sends the copy back to
  // markdownFromList().
  function withCurrentMarks(markdown: string, list: Element): string | null {
    const items = Array.from(list.querySelectorAll("li"));
    const lines = markdown.split("\n");
    let index = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*-( |$)/.test(lines[i])) continue;
      const element = items[index++];
      if (!element) return null;
      const mark = isDoneItem(element) ? "x" : " ";
      lines[i] = lines[i].replace(/^(\s*- )\[[ xX]\]/, "$1[" + mark + "]");
    }
    return index === items.length ? lines.join("\n") : null;
  }

  // Initialize a single button/list pair
  function initButton(button: Element): void {
    const wrapper = button.closest(".chx-btn-block");
    if (!wrapper) return;

    const list = wrapper.nextElementSibling;
    if (!list) return;

    const noteId = button.getAttribute("data-chx-note") || "";
    const listId = readListId(button);
    postState({ type: "getState", noteId: noteId, listId: listId }).then(
      function (result) {
        const hideDone = result.hideDone;
        if (hideDone) {
          list.classList.add("chx-done-hidden");
        } else {
          list.classList.remove("chx-done-hidden");
        }
        updateButton(button, hideDone);
      },
      function (err) {
        console.warn("CheckboxHide: could not get renderer state:", err);
      },
    );
  }

  // Fallback for pages the renderer did not add Button bars to: bars carry
  // List IDs from the line rule (docs/adr/0001), so as soon as the renderer
  // added any, adding more here would only add competing IDs.
  function insertMissingButtons(): void {
    if (document.querySelector(".chx-btn-block:not([data-chx-fallback])")) {
      return;
    }
    const lists = document.querySelectorAll("ul");
    let checkboxListIndex = 0;
    lists.forEach(function (list) {
      const previous = list.previousElementSibling as HTMLElement | null;

      const items = Array.from(list.children).filter(function (item) {
        return item.tagName === "LI";
      });
      if (!items.length) return;

      const isRichTextChecklist =
        list.classList.contains("joplin-checklist") ||
        list.getAttribute("data-is-checklist") === "1";
      if (
        !isRichTextChecklist &&
        !items.every(function (item) {
          return (
            item.classList.contains("joplin-checkbox") ||
            !!item.querySelector('input[type="checkbox"]')
          );
        })
      ) {
        return;
      }

      const listId: ListId = `list-${checkboxListIndex++}`;
      let depth = 0;
      let ancestor = list.parentElement;
      while (ancestor) {
        if (ancestor.tagName === "UL") depth++;
        ancestor = ancestor.parentElement;
      }
      list.setAttribute("data-chx-list", listId);
      list.classList.add("chx-list");
      if (previous && previous.classList.contains("chx-btn-block")) {
        const existingButton = previous.querySelector("button.chx-toggle");
        if (existingButton && !existingButton.getAttribute("data-chx-list")) {
          existingButton.setAttribute("data-chx-list", listId);
        }
        const existingCopyButton = previous.querySelector("button.chx-copy");
        if (
          existingCopyButton &&
          !existingCopyButton.getAttribute("data-chx-list")
        ) {
          existingCopyButton.setAttribute("data-chx-list", listId);
        }
        previous.setAttribute("data-chx-depth", String(depth));
        previous.style.marginLeft = "";
        return;
      }

      let done = 0;
      items.forEach(function (item) {
        const isDone = isDoneItem(item);
        if (isDone) done++;
        item.classList.toggle("chx-done", isDone);
        item.classList.toggle("chx-undone", !isDone);
      });
      list.classList.add("chx-list");

      // Same markup as checkboxRenderer.ts's buildButtonHtml(): inline
      // elements inside a list item, block elements everywhere else.
      const inline =
        !!list.parentElement && list.parentElement.tagName === "LI";
      const wrapper = document.createElement(inline ? "span" : "div");
      wrapper.className = "joplin-editable chx-btn-block";
      wrapper.setAttribute("data-chx-fallback", "");
      wrapper.setAttribute("data-chx-depth", String(depth));
      const source = document.createElement(inline ? "span" : "pre");
      source.className = "joplin-source";
      source.setAttribute("data-joplin-language", "md");
      source.setAttribute("data-joplin-source-open", "");
      source.setAttribute("data-joplin-source-close", "");
      source.hidden = true;
      wrapper.appendChild(source);

      const toolbar = document.createElement(inline ? "span" : "div");
      toolbar.className = "chx-toolbar";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "chx-toggle";
      button.setAttribute("data-chx-note", "");
      button.setAttribute("data-chx-list", listId);
      button.setAttribute("data-chx-done", String(done));
      button.setAttribute("data-chx-total", String(items.length));
      button.setAttribute("aria-pressed", "false");
      const action = document.createElement("span");
      action.className = "chx-action";
      action.textContent = t("hide");
      const count = document.createElement("span");
      count.className = "chx-count";
      count.textContent = done + " / " + items.length;
      button.appendChild(action);
      button.appendChild(count);
      toolbar.appendChild(button);

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "chx-copy";
      copyButton.setAttribute("aria-label", t("copyAria"));
      copyButton.title = t("copyAria");
      copyButton.setAttribute("data-chx-note", "");
      copyButton.setAttribute("data-chx-list", listId);
      copyButton.innerHTML = COPY_ICON;
      toolbar.appendChild(copyButton);

      wrapper.appendChild(toolbar);
      list.parentNode!.insertBefore(wrapper, list);
    });
  }

  // A Done item: a rich text checklist item marked "checked", or an item whose
  // own checkbox is ticked (the live property, which follows clicks).
  function isDoneItem(item: Element): boolean {
    if (item.classList.contains("checked")) return true;
    const input = item.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    return !!input && input.closest("li") === item && input.checked;
  }

  // Keeps every toolbar's "done / total" and each item's chx-done/chx-undone
  // class in step with its list as checkboxes are toggled. Writes only what
  // changed: the MutationObserver that calls this would otherwise fire again.
  function refreshCounts(): void {
    const buttons = document.querySelectorAll(
      ".chx-btn-block button.chx-toggle",
    );
    buttons.forEach(function (button) {
      const wrapper = button.closest(".chx-btn-block");
      const list = wrapper && wrapper.nextElementSibling;
      if (!list) return;

      const items = Array.from(list.children).filter(function (item) {
        return item.tagName === "LI";
      });
      let done = 0;
      items.forEach(function (item) {
        const isDone = isDoneItem(item);
        if (isDone) done++;
        item.classList.toggle("chx-done", isDone);
        item.classList.toggle("chx-undone", !isDone);
      });

      const text = done + " / " + items.length;
      const count = button.querySelector(".chx-count");
      if (count && count.textContent !== text) count.textContent = text;
      button.setAttribute("data-chx-done", String(done));
      button.setAttribute("data-chx-total", String(items.length));

      alignBar(wrapper as HTMLElement, items);
    });
  }

  // Starts a Button bar where its list's first checkbox is drawn, as in the
  // Markdown editor. The preview draws an <input>; the rich text editor draws
  // Joplin's absolutely positioned li::before, which has no box of its own,
  // so its place is worked out from the item's content edge and its margin.
  function alignBar(bar: HTMLElement, items: Element[]): void {
    const start = drawnListStart(items);
    if (start === null) return;
    const padding = start - bar.getBoundingClientRect().left;
    const value = padding > 0 ? padding.toFixed(2) + "px" : "";
    if (bar.style.paddingLeft !== value) bar.style.paddingLeft = value;
  }

  function drawnListStart(items: Element[]): number | null {
    const item = items[0];
    if (!item || !item.parentElement) return null;
    const px = function (value: string): number {
      return parseFloat(value) || 0;
    };
    // Items may be hidden Done items, so their content edge comes from the
    // list's box and the computed styles, which hidden elements keep too.
    const list = item.parentElement;
    const listStyle = window.getComputedStyle(list);
    const itemStyle = window.getComputedStyle(item);
    const contentLeft =
      list.getBoundingClientRect().left +
      px(listStyle.borderLeftWidth) +
      px(listStyle.paddingLeft) +
      px(itemStyle.marginLeft) +
      px(itemStyle.borderLeftWidth) +
      px(itemStyle.paddingLeft);

    const input = item.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    if (input && input.closest("li") === item) {
      const rect = input.getBoundingClientRect();
      if (rect.width > 0) return rect.left;
      return contentLeft + px(window.getComputedStyle(input).marginLeft);
    }
    const before = window.getComputedStyle(item, "::before");
    if (
      before.content &&
      before.content !== "none" &&
      before.content !== "normal"
    ) {
      return contentLeft + px(before.marginLeft);
    }
    return contentLeft;
  }

  // Initialize all buttons
  function initAll(): void {
    insertMissingButtons();
    const buttons = document.querySelectorAll<HTMLButtonElement>(
      ".chx-btn-block button.chx-toggle",
    );
    buttons.forEach(function (button) {
      if (button.dataset.chxInitialized) return;
      button.dataset.chxInitialized = "true";
      initButton(button);
      button.addEventListener("click", toggleClick);
    });
    const copyButtons = document.querySelectorAll<HTMLButtonElement>(
      ".chx-btn-block button.chx-copy",
    );
    copyButtons.forEach(function (button) {
      if (button.dataset.chxCopyInitialized) return;
      button.dataset.chxCopyInitialized = "true";
      button.addEventListener("click", copyClick);
    });
    const bars = document.querySelectorAll<HTMLElement>(".chx-btn-block");
    bars.forEach(function (bar) {
      if (bar.dataset.chxBarInitialized) return;
      bar.dataset.chxBarInitialized = "true";
      // The buttons have handled the click by now; see shieldBarPress().
      bar.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    });
    refreshCounts();
  }

  // The rich text editor (TinyMCE) treats a Button bar as a non-editable
  // block: a press that reaches it selects the whole bar (blue frame), Joplin
  // then copies that selection instead of the Checklist, and a double click
  // opens Joplin's source editor. Presses on a bar therefore stop here.
  function shieldBarPress(event: Event): void {
    const target = event.target as Element | null;
    if (!target || !target.closest || !target.closest(".chx-btn-block")) return;
    if (event.type === "mousedown") event.preventDefault();
    event.stopPropagation();
  }

  // True when a rich text checklist item gained or lost its "checked" class.
  // Other class writes (including our own, and classList.add() rewriting an
  // unchanged attribute) must not re-trigger the observer.
  function isCheckedToggle(record: MutationRecord): boolean {
    const target = record.target as Element;
    if (record.type !== "attributes" || target.tagName !== "LI") return false;
    const wasChecked = /(^|\s)checked(\s|$)/.test(record.oldValue || "");
    return wasChecked !== target.classList.contains("checked");
  }

  function start(): void {
    initAll();
    ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick"].forEach(
      function (type) {
        document.addEventListener(type, shieldBarPress, true);
      },
    );
    // Preview checkboxes fire "change"; rich text checklist items toggle their
    // "checked" class instead, which the observer picks up.
    document.addEventListener("change", refreshCounts, true);
    // Layout settles after the script runs (styles, fonts, the rich text
    // editor's setup), and alignBar() must follow it.
    window.addEventListener("resize", refreshCounts);
    window.addEventListener("load", refreshCounts);
    if (document.fonts) document.fonts.ready.then(refreshCounts);
    if (typeof ResizeObserver !== "undefined" && document.body) {
      new ResizeObserver(refreshCounts).observe(document.body);
    }
    if (typeof MutationObserver !== "undefined" && document.documentElement) {
      const observer = new MutationObserver(function (records) {
        if (records.some((record) => record.type === "childList")) initAll();
        else if (records.some(isCheckedToggle)) refreshCounts();
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["class"],
        attributeOldValue: true,
      });
    }
  }

  // Auto-init on DOM ready
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }
})();
