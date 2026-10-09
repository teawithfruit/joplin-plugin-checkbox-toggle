// ============================================================================
// CheckboxHide - types.ts
// ============================================================================
// Domain types, named after GLOSSARY.md. Type-only: nothing here exists at
// runtime.
// ============================================================================

// A Checklist's position among the note's Checklists in document order.
export type ListId = `list-${number}`;

// The Hide State of one Checklist as answered by the plugin. An empty listId
// addresses the note-wide default rather than a single Checklist.
export interface HideState {
  hideDone: boolean;
  noteId: string;
  listId: ListId | "";
}

// A Checklist found by a scan, with its Done item count.
export interface Checklist {
  listId: ListId;
  depth: number;
  done: number;
  total: number;
}
