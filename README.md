# Joplin Checkbox Toggle

A Joplin plugin that adds a per-list hide/show toggle for completed checklist items. It remembers the preference per note so each note can keep its own checklist visibility state, and it works across the rendered markdown preview, the rich text editor, and both CodeMirror editor variants used by Joplin.

## What it does

The plugin scans markdown checklists and inserts a compact toolbar above each list. That toolbar lets you:

- hide completed items in a list
- reveal them again when needed
- copy the raw markdown for that checklist
- keep the toggle state saved per note

The hidden state is stored in Joplin note user data under the `checkboxHide` key, so the same note behaves consistently across the preview and editor surfaces.

## Features

- per-note state, not global state
- per-list overrides within a note
- works in rendered markdown and editor panes
- supports CodeMirror 5 and CodeMirror 6
- copies the checklist markdown exactly as the note contains it
- keeps the original note source intact for Joplin’s rich text workflow

## How it works

The plugin registers separate content scripts for:

- the markdown preview renderer
- the CodeMirror 5 editor integration
- the CodeMirror 6 editor integration

Each checklist is identified and annotated with metadata from the note source. The renderer then injects a toggle button and count like `3 / 10` before the list. When the button is pressed, the plugin updates the note’s stored state and re-renders the list with completed items hidden or shown.

## Installation

From the project root:

```bash
npm install
npm run dist
```

The generated plugin archive is created in `publish/`.

Then load the package in Joplin using the plugin management flow for local plugin builds.

## Development

```bash
npm run typecheck      # TypeScript validation
npm run lint           # ESLint
npm run format:check   # Prettier
npm test               # Node tests for logic, editing behavior, and jsdom checks
npm run test:browser   # Browser tests for rendered layouts and editor behavior
npm run dist           # Build the plugin archive
```

One-time browser setup:

```bash
npx playwright install chromium
```

## Publishing

This project uses the npm staging flow for releases:

```bash
npm run release
```

That command builds the plugin and then stages it with `npm stage publish --access public`.

Before releasing, verify:

- Node and npm meet the version requirements for `npm stage`
- `package.json` has the correct package metadata
- you are logged in to npm with publish permissions

## Project references

- [GENERATOR_DOC.md](./GENERATOR_DOC.md) — Joplin plugin generator notes
- [.planning/codebase/ARCHITECTURE.md](./.planning/codebase/ARCHITECTURE.md) — project architecture overview
- [.planning/codebase/STRUCTURE.md](./.planning/codebase/STRUCTURE.md) — repository layout and module map

## License

This project is licensed under the MIT license.
