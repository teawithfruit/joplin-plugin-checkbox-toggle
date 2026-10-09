# Codebase Structure

**Analysis Date:** 2026-10-05

## Directory Layout

```
./joplin-plugin-checkbox-toggle/
├── .agents/skills/            # Agent skills and workflow docs
├── .planning/codebase/        # Architecture and structure notes
├── .github/workflows/         # CI/release automation
├── api/                       # Joplin API type declarations used by the plugin
├── browser-tests/             # Playwright browser tests and fixture pages
├── dist/                      # Generated bundle output from webpack
├── docs/                      # User and agent docs, ADRs, repo guidelines
├── src/                       # Plugin source code
│   ├── checkboxRenderer.ts         # Markdown preview / rendered-list toggle UI
│   ├── checkboxRendererBrowser.ts  # Browser-side renderer logic for injected HTML
│   ├── contentScript.ts            # CodeMirror 6 editor integration
│   ├── contentScriptCm5.ts         # CodeMirror 5 editor integration
│   ├── listScanner.ts              # Checklist scanning and list identity logic
│   ├── stateManager.ts             # Per-note persistence and state caching
│   ├── locale.ts                   # Localization strings
│   ├── clipboard.ts                # Copy/clipboard behavior
│   ├── messages.ts                 # Shared message types
│   ├── pluginMessages.ts           # Plugin message routing and note-data plumbing
│   ├── types.ts                    # Shared TS types
│   ├── checkboxHideCm5.css        # CM5-specific hidden-state styling
│   └── manifest.json               # Plugin manifest copied into build output
├── tests/                     # Node-based unit tests
├── AGENTS.md                  # Repo-wide agent instructions
├── GLOSSARY.md                # Domain vocabulary and naming conventions
├── README.md                  # User-facing plugin description and usage
├── package.json               # Scripts, dependencies, and project metadata
├── playwright.config.ts       # Playwright browser test config
├── plugin.config.json         # Joplin plugin config override
├── tsconfig.json              # Main TypeScript config
├── tsconfig.node.json         # Node/test TypeScript config
├── webpack.config.cjs         # Build configuration
├── publish/                   # Final packaged plugin artifact output
├── skills-lock.json           # Locked skill metadata
└── README.md                 # Project entry point documentation
```

## Documentation and Agent-Facing Files

This repo keeps its documentation in a small set of layers:

- `docs/agents/` holds repo-local agent conventions, issue-tracker rules, and guidance for how work is documented.
- `.planning/codebase/` holds architecture and structure snapshots keyed to the current repo state.
- `.agents/skills/` contains task-specific skills, each with a compact description and its own rule set.

The pattern is intentionally pointer-driven: long or branch-specific guidance lives behind a short trigger, while the current task remains readable. The goal is a single source of truth, not duplicated instructions spread across several files.

## Directory Purposes

**src/**:

- Purpose: Main implementation of the plugin logic.
- Contains: renderer logic, editor integrations, state persistence, scanning logic, clipboard and locale helpers.
- Key files: `index.ts`, `stateManager.ts`, `checkboxRenderer.ts`, `checkboxRendererBrowser.ts`, `contentScript.ts`, `contentScriptCm5.ts`, `listScanner.ts`

**api/**:

- Purpose: Type declarations for Joplin's plugin API surface.
- Contains: `index.ts` and a set of `Joplin*.d.ts` declarations with the editor/plugin interfaces.
- Used by: TypeScript compilation and plugin runtime typing.

**tests/**:

- Purpose: Fast Node-based checks for rendering, state behavior, copy handling, and list scanning.
- Contains: unit tests around checkbox logic, clipboard, state persistence, and renderer shape.

**browser-tests/**:

- Purpose: Browser-level checks that exercise the rendered preview and editor behavior in realistic Joplin-like fixtures.
- Contains: Playwright specs and HTML/TS fixture pages for preview and rich-text flows.

**docs/**:

- Purpose: Project docs and agent guidance.
- Contains: ADRs, agent docs, and repo-specific instructions.

**.agents/** and **.planning/**:

- Purpose: Agent workflow documentation and architecture snapshots.
- Contains: skills, task-specific instruction files, and static repo structure/architecture notes.

**dist/**:

- Purpose: Generated webpack bundle output.
- Contains: compiled JS/CSS files for the plugin build.
- Generated: Yes, by webpack.
- Committed: Usually no, unless intentionally checked in for a release snapshot.

**publish/**:

- Purpose: Final packaged plugin archive output.
- Contains: generated `.jpl` artifact and metadata used for release packaging.
- Generated: Yes, by the packaging build step.

## Key File Locations

**Entry Points:**

- `src/index.ts`: plugin startup; registers the markdown renderer and editor content scripts; wires message handling to the state manager.
- `src/checkboxRenderer.ts`: generated checkbox list renderer used by the markdown preview path.
- `src/contentScript.ts`: CodeMirror 6 editor integration and toggle behavior.
- `src/contentScriptCm5.ts`: CodeMirror 5 editor integration and toggle behavior.

**State and Persistence:**

- `src/stateManager.ts`: per-note hidden-state cache, normalization, and persistence against Joplin user data.
- `src/pluginMessages.ts`: message handler and transaction logic between content scripts and the plugin.
- `src/messages.ts`: shared message type definitions.

**Checklist and Display Logic:**

- `src/listScanner.ts`: list detection and checklist identity logic that decides which checkbox groups are managed.
- `src/checkboxRendererBrowser.ts`: DOM-side browser renderer logic used when the preview HTML is manipulated in the browser context.
- `src/checkboxHideCm5.css`: CM5-specific styling for hide/show behavior.

**Configuration and Build:**

- `package.json`: scripts, dependencies, and release commands.
- `webpack.config.cjs`: bundle configuration for the plugin and extra scripts.
- `plugin.config.json`: plugin-specific build configuration.
- `src/manifest.json`: plugin metadata and manifest definition used by Joplin.

**Testing:**

- `tests/`: Node test suite for rendering, list-state behavior, clipboard flow, and checklist identity.
- `browser-tests/`: Playwright tests exercising the preview and editor behavior in Joplin-like fixtures.

## Naming Conventions

**Files:**

- TypeScript: `*.ts` (only `index.ts` in this project)
- JavaScript: `*.js` (content scripts, state manager)
- Content scripts are named by their purpose: `markdownIt.js`, `contentScript.js`, `contentScriptCm5.js`

**Directories:**

- Flat structure in `src/` (no subdirectories)
- Build outputs in `dist/` and `publish/`

## Where to Add New Code

**New Feature (checkbox behavior change):**

- Primary code: Modify existing module based on context
  - Preview pane: `src/markdownIt.js` + `src/chx-logic.js`
  - CM6 editor: `src/contentScript.js`
  - CM5 editor: `src/contentScriptCm5.js`
- Tests: Not applicable (no tests currently)

**New Content Script Context:**

- Content script: `src/contentScriptNewVersion.js`
- Registration: Add to `joplin.contentScripts.register` in `src/index.ts`
- Message handler: Add to existing `handleStateMessage` or new handler

**Utilities:**

- Shared helpers: Currently no shared utilities — all logic is per-context
- If needed: Create `src/utils/` or `src/common/` directory

## Special Directories

**src/**

- Purpose: Source code for all plugin functionality
- Generated: No
- Committed: Yes

**dist/**

- Purpose: Webpack output (compiled content scripts)
- Generated: Yes (by webpack)
- Committed: No

**publish/**

- Purpose: Final plugin archive (`.jpl`) and metadata
- Generated: Yes (by webpack)
- Committed: No

---

_Structure analysis: 2026-10-05_
