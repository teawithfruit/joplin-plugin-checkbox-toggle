# Checkbox Toggle

A Joplin plugin that lets users hide and show the Done items of Checklists, in every view of a note.

## Language

**Checklist**:
A Markdown bullet list in which every item is a checkbox, delimited by Markdown list rules as the preview renders them (blank lines between items do not split it; a change of bullet marker does). Ordered lists and lists inside blockquotes are not Checklists. The same note text yields the same Checklists in every view.
_Avoid_: checkbox list, list (when the checkbox-only kind is meant), todo list

**Nested Checklist**:
A Checklist that sits inside an item of another Checklist. It is a Checklist in its own right, and is also hidden whenever an enclosing Checklist hides its Done items.
_Avoid_: sub-list, child list

**List ID**:
The identity of a Checklist within a note: its position among the note's Checklists in document order (`list-0`, `list-1`, …). Inserting a Checklist above another shifts the latter's List ID.
_Avoid_: list index, list key

**Button bar**:
The toggle and copy buttons shown above a Checklist in every view.
_Avoid_: toolbar, button block, toggle button

**Done item**:
A Checklist item whose checkbox is ticked (`[x]` or `[X]`).
_Avoid_: completed item, checked item, finished item

**Hide State**:
Whether a Checklist's Done items are hidden, remembered per note and List ID.
_Avoid_: toggle state, list state, visibility
