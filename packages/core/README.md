# `@docx-editor.dev/core` (contract)

**This package contains no implementation.** It declares the public API that
`@docx-editor.dev/core` must satisfy. The published package is installed from
npm.

It is `"private": true` and must never be published. Publishing it would shadow
the real package on npm with a set of functions that throw.

## Why it exists

Core used to live in the same monorepo as its consumers, so the boundary between
them was never designed. Measured:

| | |
| --- | --- |
| Declared entry points | 65 |
| Distinct public symbols | 1,125 |
| Subpaths adapters import | 65 |
| Distinct symbols adapters import | 428, across 458 sites |
| Subpaths imported but never exported | 12 |

Four of those unexported subpaths (`flow-model`, `pagination-model`,
`painter-model`, `editor`) are flagged by `scripts/check-package-artifacts.mjs`
as private internals that published artifacts must never import. They resolved
only through the monorepo `tsconfig` wildcard, so the build simultaneously
depended on them and rejected them. Once core moved out, they stopped resolving.

## Shape

| Entry | For | Status |
| --- | --- | --- |
| `@docx-editor.dev/core` | agents, headless, server | stable |
| `@docx-editor.dev/core/editor` | React / Vue adapters | stable |
| `@docx-editor.dev/core/geometry` | adapter internals | **`@experimental`, semver-exempt** |
| `@docx-editor.dev/core/plugin` | extension authors | stable |
| `@docx-editor.dev/core/mcp` | MCP hosts | stable |
| `@docx-editor.dev/core/types` | everyone | type-only, zero runtime |

### Decisions worth knowing

**Addressing is `{ paraId, search }`, not `{ blockId, offset }`.** Offset
addressing was already tried in `types/agentApi.ts` and the agents package uses
none of it: a model cannot compute an offset it has not seen, and offsets do not
survive concurrent edits. `search` must match exactly once, and ambiguity is an
error rather than first-match-wins.

**Commands are open, not a sealed union.** `DocEdits` and `EditorCommands` are
interfaces widened by declaration merging, because a sealed union cannot be
extended by a plugin. Runtime JSON Schemas ship alongside (`docEditSchemas`),
since a TypeScript union vanishes at compile time and MCP `tools/list` needs
real schemas.

**Writes return `ExecResult`, not `boolean`.** A boolean cannot distinguish a
no-op from a missing target from a locked content control, and the editor layer
already throws eight distinct content-control error classes.

**`EditorSnapshot`, not `EditorState`.** The latter collides with
`prosemirror-state` across 18 adapter import sites.

**`EditorHost` has 12 members, not 3.** DOM handles are getters because they are
null through first render and React's scroll container changes identity.
Scheduling is two-phase: `scheduleFrame` coalesces engine work, `afterCommit`
runs after the adapter flushes its own render. `measureBlocks` is injected
because core currently calls back into the adapter to measure.

**Scopes are explicit.** The editor is N+1 ProseMirror views, one per
header/footer relationship plus the body. Commands that do not name a scope hit
the wrong surface when a header has focus.

**`core/geometry` is a compatibility shelf, not a design.** 86 symbols across 73
sites are in live adapter use; a few methods on `Editor` cover roughly eight of
them. It is named honestly and marked semver-exempt rather than left leaking.
Cache-invalidation calls (`clearAllCaches`, `resetCanvasContext`,
`syncImeCaretAnchor`) are deliberately absent: they mutate module-scope state,
which breaks multiple editors on one page. Callers use
`editor.relayout({ sync: true })`.

## Status

The adapters do **not** compile against this contract yet. They still import the
older subpaths, so adding this package does not by itself make the repo
typecheck. Migrating the adapters onto this surface is separate work, and should
follow the in-flight engine unification (#696) rather than race it.
