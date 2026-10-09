# Writing for Agents

Agent-facing docs work differently from human docs. They are not just narrative reference; they shape the choices an agent makes in context, so the document should be legible, precise, and cheap to reach.

## Use context pointers, not duplication

A context pointer is a compact trigger that points to out-of-context material when a branch of work needs it. Treat skill descriptions, `AGENTS.md` lines, and repo pointers as one kind of mechanism: they are cheap at rest, expensive when they are vague.

Use a pointer when:

- the rule is long or branch-specific
- the rule belongs in a dedicated file
- the same rule should be reused from several places

Inline the material when:

- every branch of the task needs it
- it is short enough to absorb without clutter
- the rule should influence every run immediately

The pointer's wording matters. A weak pointer that says "check docs on code quality" is a variance bug; a sharper pointer such as "see the repo's TypeScript standards before touching `src/`" is specific and discoverable.

## Prefer progressive disclosure

Documents for agents benefit from a clear information hierarchy:

1. in-file steps: the ordered action the agent is currently taking
2. in-file reference: rules used on demand in a single document
3. disclosed reference: material behind a context pointer, loaded only on trigger

Push details down when they are not needed on every pass. Keep the top of the file readable and let the pointer carry the precise rule set. The agent should not have to scan a long document to find the one branch that matters.

## Keep a single source of truth

Every meaning should live in one place. If a rule appears in both a skill and a repo document, then the agent has to discover two versions of the same truth. Prefer one authoritative home, and a pointer to it from any other place that only needs the route.

This also applies to conventions that the environment already knows:

- package scripts
- config files
- repo layout
- CLI help output

Document the intent or the gotcha only when the environment cannot tell it. Do not duplicate what can be checked immediately.

## Use leading words sparingly

A leading word is a compact concept the agent can latch onto quickly: "tight", "red", "fog of war". Use it when it reduces ambiguity and helps the agent reach the same behavior across several places.

Prefer existing, common terms over invented jargon. A good leading word makes decisions obvious; a vague phrase does not. When a sentence can be replaced by one strong term, prefer the term.

## Write completion criteria that are checkable

Every step should end on a clear completion condition. A goal like "understand the issue" is too fuzzy. Prefer goals such as "all changed files are accounted for and the fix is verified by the relevant tests".

The strongest criteria are both:

- checkable: the agent can tell when it is done
- exhaustive: the agent can tell it has covered the necessary work

If a step rushes because later steps are still visible, split the sequence. If the rule is too fuzzy to bound, tighten the wording before hiding the work behind more structure.

## Keep docs branch-aware

A good agent document names the branches it applies to. When a rule matters only in one case, say so explicitly:

- choose model-invoked vs user-invoked skill
- route to the correct doc for a specific branch of work
- separate sequence guidance from reference guidance

Branch-aware wording avoids the common failure mode where a doc looks correct but is never loaded in the right context.

## Repo guidance for this project

The repo already separates documentation by purpose:

- `docs/agents/`: local agent and repo conventions
- `.planning/codebase/`: architecture and structure notes for the codebase
- `.agents/skills/`: task- and workflow-specific skill docs

When writing or revising agent-facing material in this repo, keep the rule under the most relevant layer and use pointers to avoid duplicate instruction spread. The goal is a tight, navigable system where the agent reaches the needed document exactly when it needs it.
