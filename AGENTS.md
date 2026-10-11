## Agent skills

### Issue tracker

Issues and specs for this repo live as markdown files in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

The skills use five canonical triage roles mapped to label strings in this repo. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo: `GLOSSARY.md` lives at the root and ADRs live in `docs/adr/`. See `docs/agents/domain.md`.

### TypeScript

All source (`src/`), tests (`tests/`) and browser tests (`browser-tests/`) are strict TypeScript. `tsconfig.json` covers the whole program (webpack uses it); `tsconfig.node.json` adds `erasableSyntaxOnly` and `verbatimModuleSyntax` for everything except `src/index.ts`, because tests run unbundled under Node's type stripping (`npm test`) and `src/index.ts` pulls in the generator-owned `api/` (enums). Relative imports use `.ts` extensions. Check with `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm test`; format with `npm run format` (Prettier, default settings).

### Testing

- `npm test` (Node's test runner, files in `tests/*.test.ts`, jsdom for DOM): logic, markup, messages, persistence, the content scripts in jsdom (CM6 with a real CodeMirror editor, CM5 with a fake one), copy, and the round trip through Joplin's turndown (`@joplin/turndown`).
- `npm run test:browser` (Playwright, `browser-tests/*.spec.ts`): what needs layout or a real editor. `browser-tests/globalSetup.ts` bundles the test pages in `browser-tests/fixtures/` from `src` with webpack; the pages mimic Joplin (`fixtures/joplin.ts`: Joplin's list/checkbox styles and markup, TinyMCE configured like Joplin's rich text editor with its save triggers and copy handler). First run: `npx playwright install chromium`.
- When fixing a bug, add a test that fails without the fix (reintroduce the bug once to check).

### Architecture

Architecture decisions and deepening specs live in `.scratch/architecture-deepening/`. See `.scratch/architecture-deepening/spec.md`.
