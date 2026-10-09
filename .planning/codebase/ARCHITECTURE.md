<!-- refreshed: 2026-10-09 -->

# Architecture

**Analysis Date:** 2026-10-09

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                         Joplin Plugin Runtime                         │
│                 `src/index.ts` registers the plugin                   │
├───────────────────────────────┬──────────────────────────────────────┤
│     Entry / orchestration     │       Data + state layer            │
│  plugin startup + script      │  `stateManager.ts` + note userData  │
│  registration + message hook  │  (`checkboxHide`)                  │
├───────────────────────────────┼──────────────────────────────────────┤
│      Markdown renderer        │     Editor content scripts          │
│  `checkboxRenderer.ts`       │  `contentScript.ts` (CM6)          │
│  `checkboxRendererBrowser.ts`│  `contentScriptCm5.ts` (CM5)      │
├───────────────────────────────┼──────────────────────────────────────┤
│        Checklist logic        │       Validation / tests           │
│  `listScanner.ts`             │  `tests/` + `browser-tests/`       │
└───────────────────────────────┴──────────────────────────────────────┘
```

The plugin does not keep a single in-memory app state. Instead, it persists the hide/show decision for each note in Joplin’s note user data, then exposes the same state model to every context that renders the note: preview pane, rich-text editor, and the two CodeMirror editors.

## Component Responsibilities

| Component                  | Responsibility                                                                                                  | File                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| **Plugin bootstrap**       | Registers the markdown renderer and editor content scripts, wires message handlers, initializes the state layer | `src/index.ts`                                              |
| **State manager**          | Reads and writes note-local `checkboxHide` state, normalizes legacy values, and keeps a per-note cache          | `src/stateManager.ts`                                       |
| **Message bridge**         | Routes content-script requests into state reads/writes with note IDs and optional list IDs                      | `src/pluginMessages.ts`                                     |
| **Rendered checkbox UI**   | Builds the visible toggle button and hidden/visible checklist markup for preview and rich-text output           | `src/checkboxRenderer.ts`, `src/checkboxRendererBrowser.ts` |
| **Checklist scanner**      | Detects lists, identifies list boundaries, and computes which checklist items belong together                   | `src/listScanner.ts`                                        |
| **CM6 editor integration** | Applies list-specific hide state inside the CodeMirror 6 editor using editor state and decorations              | `src/contentScript.ts`                                      |
| **CM5 editor integration** | Mirrors the same state behavior in the legacy CodeMirror 5 editor using line widgets                            | `src/contentScriptCm5.ts`                                   |
| **Shared typing**          | Defines the state contract for list IDs, hide state, note payloads, and message shapes                          | `src/types.ts`, `src/messages.ts`                           |
| **Tests**                  | Validates renderer behavior, state flow, list scanning, clipboard round-trips, and browser/editor integration   | `tests/`, `browser-tests/`                                  |

## Pattern Overview

**Overall:** This is a Joplin plugin with one persisted note state and several presentation layers. The same state semantics are used across markdown preview, rich text, and both CodeMirror editors, but each environment has a different rendering mechanism.

**Key characteristics:**

- A single note-level state model (`checkboxHide`) is shared by multiple content-script contexts.
- State is persisted via Joplin’s `userDataGet` / `userDataSet` API instead of browser-local storage.
- The plugin has a renderer path and an editor path, both driven by the same hide/show decision.
- The architecture is intentionally split by UI environment, not by feature domain.
- Tests are layered: node-based tests cover logic and snapshot behavior; browser tests cover the actual rendered/editor experience.

### Documentation architecture

This repo keeps operational guidance in layers:

- `docs/agents/` contains repo-local rules for how agent work is documented and tracked.
- `.planning/codebase/` holds architecture and structure snapshots for the codebase.
- `.agents/skills/` contains task-specific workflows and reusable skill instructions.

The same principle applies to the code itself: keep the shared truth in one place and let each context consume it through a thin adapter.

## Layers

### Entry Point Layer

**Purpose:** Start the plugin and register content scripts.
**Location:** `src/index.ts`
**Contains:** `onStart`, script registration, and message handler wiring.
**Depends on:** Joplin plugin APIs, state manager, per-note note ID lookup.
**Used by:** Joplin when the plugin starts.

### State Persistence Layer

**Purpose:** Store and retrieve the note-scoped hide/show preferences.
**Location:** `src/stateManager.ts`
**Contains:** `getState`, `setState`, normalization, cache management, legacy fallback handling.
**Data model:**

```ts
interface StoredHideStates {
  version: 2;
  defaultHideDone: boolean;
  lists: Record<string, boolean>;
}
```

**Depends on:** Joplin `userData` API.
**Used by:** content scripts and renderer messages.

### Rendering Layer (Markdown / Browser)

**Purpose:** Render the checklist toggle UI in the markdown preview and rich-text browser view.
**Location:** `src/checkboxRenderer.ts`, `src/checkboxRendererBrowser.ts`
**Contains:** HTML generation, per-list counts, visibility toggles, and browser-side interaction handling.
**Depends on:** shared state shape, list scanning, `userData` state via plugin messages.
**Used by:** rendered note content shown in Joplin’s preview/rich-text surfaces.

### List-Detection Layer

**Purpose:** Identify checklist blocks and map them to persistent state by list identity.
**Location:** `src/listScanner.ts`
**Contains:** list boundary detection, list normalization, identity logic, and list-item classification.
**Depends on:** source markdown or editor text lines.
**Used by:** renderer and editor integrations.

### Editor Integration Layer

**Purpose:** Keep the hide/show behavior in sync with both editor modes.
**Location:** `src/contentScript.ts`, `src/contentScriptCm5.ts`
**Contains:** editor view setup, decorations/line widgets, event handlers, and refresh logic after a user clicks a toggle.
**Depends on:** editor APIs, state manager via plugin messages.
**Used by:** CodeMirror 6 and CodeMirror 5 note editing contexts.

### Message Bridge Layer

**Purpose:** Decouple editor and renderer contexts from Joplin’s note-data API.
**Location:** `src/pluginMessages.ts`, `src/messages.ts`
**Contains:** request/response helpers for `getState` and `setState` messages.
**Depends on:** note ID retrieval and message routing from content scripts.
**Used by:** every render/editor context that needs state.

### Validation / Test Layer

**Purpose:** Exercise the plugin in fast unit tests and browser-level integration tests.
**Location:** `tests/`, `browser-tests/`
**Contains:** renderer tests, list-state tests, content-script tests, clipboard tests, browser page fixtures.
**Depends on:** compiled sources and Joplin-like fixtures.
**Used by:** CI and local verification.

## Data Flow

### 1. Plugin start and registration

1. Joplin starts the plugin.
2. `src/index.ts` runs `stateManager.init(noteUserData(joplin.data, ModelType.Note))`.
3. `onStart` registers:
   - the markdown renderer
   - the CM6 content script
   - the CM5 content script
4. Each content script receives a message bridge that can request note-local state.

### 2. State read flow

1. A renderer or editor context needs the current hide/show decision.
2. It posts a message through `contentScripts.onMessage` to the plugin.
3. `createMessageHandler` resolves the current note ID and forwards the request.
4. `stateManager.getState(noteId, listId)` looks in the cache.
5. If absent, it calls Joplin `userDataGet` for the note key `checkboxHide`.
6. `normalizeState` converts legacy/invalid values into the current shape.
7. `readListState` resolves the effective state for either the note default or one specific list.
8. The result is returned to the content script and used to hide or show checklist items.

### 3. Toggle write flow

1. User clicks a toggle button in a rendered list or editor widget.
2. The relevant content script computes the new hide/show value for the list or note default.
3. The script posts a `setState` request back to the plugin.
4. `stateManager.setState(noteId, listId, hideDone)` loads the note’s current state.
5. It updates either `defaultHideDone` or `lists[listId]`.
6. The updated state is written back to Joplin user data and cached in memory.
7. The relevant UI refreshes to reflect the new hidden/visible state.

### 4. Round-trip behavior in rendered output

The plugin deliberately keeps the original markdown in a hidden source structure so the rendered list can later round-trip cleanly through Joplin’s rich-text pipeline. This lets toggling hide/show work without destroying the underlying note content.

## Key Abstractions

### State model

The decisive abstraction is the note-level state object stored in user data:

- `defaultHideDone`: note-wide default for list visibility
- `lists`: per-list overrides keyed by list identity
- `version`: schema version used for compatibility and normalization

This is the single truth the renderer and editor contexts share.

### Message bridge

The plugin exposes one narrow boundary between browser/editor contexts and the Joplin data API: a shared message-routing layer. That keeps `stateManager` from becoming tightly coupled to DOM or editor-specific code.

### Renderer/editor split

The project intentionally duplicates the UI strategy by environment rather than by feature. The preview path builds HTML; the editor paths build decorations or widgets. They all consume the same state shape and the same persistence contract.

### Type boundary

The `api/` directory and `src/types.ts` provide the typed boundary for Joplin APIs and the plugin’s internal state contract. This keeps the plugin logic roughly aligned with Joplin’s API while avoiding editor-specific leakage into the core state code.

## Architectural Constraints

- **Context isolation:** renderer and editor contexts cannot share browser-local state; they must use Joplin’s note-data API.
- **Note-scoped state:** the hide/show preference is persisted per note, not globally across all notes.
- **Shared state contract:** all content-script contexts consume the same `StoredHideStates` shape.
- **UI-specific rendering:** Markdown preview, rich text, and CodeMirror all use different rendering APIs but the same state semantics.
- **Testability:** logic is split from UI so it can be validated with node tests and browser tests without relying on only one runtime.

## Cross-Cutting Concerns

**Logging:** Basic console warnings are used for non-fatal failures; no heavy structured logging layer is required for this plugin.

**Validation:** State values are normalized defensively. Invalid or legacy values default to a safe state instead of crashing the editor or renderer.

**Authentication / permissions:** Not a major concern in this plugin; it operates under the note access granted by Joplin’s user session.

---

_Architecture analysis: 2026-10-09_
