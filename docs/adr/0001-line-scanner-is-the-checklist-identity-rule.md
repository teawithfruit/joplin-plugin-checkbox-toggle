# The line scanner is the single Checklist identity rule

List IDs must agree across the preview, rich text editor, CM5 and CM6, because they key the Hide State stored in note user data. We decided that one line-based scan of the note's Markdown source is the only rule that finds Checklists and assigns List IDs; the markdown-it renderer runs that same scan on `state.src` and attaches results to list tokens by start line (`token.map[0]`), rather than deriving IDs from its own token stream.

## Considered Options

- **Two scanners kept in agreement by parity tests**: rejected, the rules drifted in practice (loose lists, mixed lists, marker changes).
- **markdown-it everywhere**: rejected, ~100 KB extra in each editor content-script bundle.
- **CM6 Lezer syntax tree**: rejected, CM5 has no equivalent, so it would reintroduce a second rule.

## Consequences

Where markdown-it and the line rule disagree on what is a list, the line rule still decides List IDs; the preview just shows no Button bar for an unmatched list. The webview script adds Button bars itself (numbered by DOM order) only on a page without any rendered ones, so it never introduces List IDs that compete with the line rule.
