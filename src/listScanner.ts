// ============================================================================
// CheckboxHide - listScanner.ts
// ============================================================================
// The single Checklist identity rule shared by every view (see GLOSSARY.md
// and docs/adr/0001): finds Checklists in Markdown lines and reports their
// List ID, nesting, line range and done/total counts.
// ============================================================================

import type { Checklist, ListId } from "./types.ts";

// A Checklist as found in the note's Markdown lines. Line indexes are 0-based;
// endLine includes nested lists and continuation lines.
export interface ScannedChecklist extends Checklist {
  indentation: number;
  indentLength: number;
  parentIds: ListId[];
  startLine: number;
  endLine: number;
  itemLines: number[];
  doneLines: number[];
}

interface BulletList {
  marker: string;
  indentation: number;
  indentLength: number;
  contentIndent: number;
  depth: number;
  parent: BulletList | null;
  startLine: number;
  endLine: number;
  items: Array<{ line: number; checkbox: boolean; done: boolean }>;
  listId?: ListId;
}

const ITEM_PATTERN = /^(\s*)([-*+])(?:([ \t]+)(.*))?$/;
const CHECKBOX_PATTERN = /^\[([xX ])\](?:\s|$)/;
const FENCE_PATTERN = /^\s*(`{3,}|~{3,})(.*)$/;

const listScanner_ = {
  // Finds the Checklists in a note's Markdown lines and assigns their List
  // IDs. Every view (editors, preview, rich text) takes its Checklists from
  // here.
  //
  // Bullet lists follow Markdown list structure: blank lines between items do
  // not end a list, a change of bullet marker starts a new one, and lines
  // indented to an item's content belong to that item. A list is a Checklist
  // only if every item is a checkbox. List IDs count Checklists in open
  // order.
  scanLines: function (lines: string[]): ScannedChecklist[] {
    const bulletLists: BulletList[] = [];
    const stack: BulletList[] = [];
    let fence: string | null = null;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      // A trailing \r (Windows line ending) is no part of the line's text.
      const text = lines[lineIndex].replace(/\r$/, "");
      if (fence) {
        const closing = text.match(FENCE_PATTERN);
        if (
          closing &&
          closing[1][0] === fence[0] &&
          closing[1].length >= fence.length &&
          !closing[2].trim()
        ) {
          fence = null;
        }
        for (const open of stack) open.endLine = lineIndex;
        continue;
      }
      if (/^\s*$/.test(text)) continue;

      const leading = (text.match(/^\s*/) || [""])[0];
      const indentation = leading.replace(/\t/g, "    ").length;
      const item = text.match(ITEM_PATTERN);

      if (!item) {
        const opening = text.match(FENCE_PATTERN);
        if (opening) fence = opening[1];
        while (
          stack.length &&
          indentation < stack[stack.length - 1].contentIndent
        ) {
          stack.pop();
        }
      } else {
        const marker = item[2];
        let list: BulletList | null = null;
        while (stack.length) {
          const top = stack[stack.length - 1];
          if (indentation >= top.contentIndent) break;
          if (indentation >= top.indentation) {
            if (top.marker === marker) list = top;
            else stack.pop();
            break;
          }
          stack.pop();
        }
        if (!list) {
          list = {
            marker: marker,
            indentation: indentation,
            indentLength: leading.length,
            contentIndent: 0,
            depth: stack.length,
            parent: stack.length ? stack[stack.length - 1] : null,
            startLine: lineIndex,
            endLine: lineIndex,
            items: [],
          };
          bulletLists.push(list);
          stack.push(list);
        }
        let gap = (item[3] || "").replace(/\t/g, "    ").length;
        if (!item[4] || gap > 4) gap = 1;
        list.contentIndent = indentation + 1 + gap;
        const checkbox = (item[4] || "").match(CHECKBOX_PATTERN);
        list.items.push({
          line: lineIndex,
          checkbox: !!checkbox,
          done: !!checkbox && checkbox[1] !== " ",
        });
      }

      for (const open of stack) open.endLine = lineIndex;
    }

    const checklists = bulletLists.filter(function (list) {
      return list.items.every(function (entry) {
        return entry.checkbox;
      });
    });
    checklists.forEach(function (list, index) {
      list.listId = `list-${index}`;
    });

    return checklists.map(function (list) {
      const parentIds: ListId[] = [];
      for (let parent = list.parent; parent; parent = parent.parent) {
        if (parent.listId) parentIds.unshift(parent.listId);
      }
      const doneLines = list.items
        .filter(function (entry) {
          return entry.done;
        })
        .map(function (entry) {
          return entry.line;
        });
      return {
        listId: list.listId!,
        indentation: list.indentation,
        indentLength: list.indentLength,
        depth: list.depth,
        parentIds: parentIds,
        startLine: list.startLine,
        endLine: list.endLine,
        done: doneLines.length,
        total: list.items.length,
        itemLines: list.items.map(function (entry) {
          return entry.line;
        }),
        doneLines: doneLines,
      };
    });
  },

  // Markdown for one list (including nested sub-lists and continuation
  // lines), written the way the rich text editor's copy writes it: "- " as
  // the bullet and two spaces per nesting level, so copying gives the same
  // text in every view. Continuation lines line up with their item's text.
  listMarkdown: function (lines: string[], list: ScannedChecklist): string {
    // Open items: their content indent in the note and the column their
    // nested content gets in the copy.
    const items: Array<{ contentIndent: number; column: number }> = [];
    let fence: string | null = null;
    const out: string[] = [];

    for (const line of lines.slice(list.startLine, list.endLine + 1)) {
      const text = line.replace(/\r$/, "");
      if (/^\s*$/.test(text)) {
        out.push("");
        continue;
      }
      const leading = (text.match(/^\s*/) || [""])[0];
      const indentation = leading.replace(/\t/g, "    ").length;
      const item = fence ? null : text.match(ITEM_PATTERN);

      while (
        items.length &&
        indentation < items[items.length - 1].contentIndent
      ) {
        items.pop();
      }
      const column = items.length ? items[items.length - 1].column : 0;

      if (item) {
        const content = item[4] || "";
        out.push(" ".repeat(column) + "-" + (content ? " " + content : ""));
        let gap = (item[3] || "").replace(/\t/g, "    ").length;
        if (!item[4] || gap > 4) gap = 1;
        items.push({
          contentIndent: indentation + 1 + gap,
          column: column + 2,
        });
        continue;
      }

      const parent = items[items.length - 1];
      const extra = parent
        ? Math.max(0, indentation - parent.contentIndent)
        : 0;
      out.push(" ".repeat(column + extra) + text.slice(leading.length));

      const marker = text.match(FENCE_PATTERN);
      if (fence) {
        if (
          marker &&
          marker[1][0] === fence[0] &&
          marker[1].length >= fence.length &&
          !marker[2].trim()
        ) {
          fence = null;
        }
      } else if (marker) {
        fence = marker[1];
      }
    }

    return out.join("\n");
  },
};

export default listScanner_;
