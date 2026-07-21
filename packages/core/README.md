# `@docx-editor.dev/core-contract`

**This package contains no implementation.** It declares the public API that
`@docx-editor.dev/core` must satisfy. The published package is installed from
npm.

It is deliberately named `@docx-editor.dev/core-contract`, not
`@docx-editor.dev/core`. Sharing the name would make the workspace resolve every
consumer to this package instead of the published one, silently, since a
workspace member outranks the registry. It is also `"private": true`, and every
entry is types-only: there is no `default` condition, so a runtime import fails
loudly rather than resolving to functions that throw.

## Why it exists

A published API needs a written contract: something that says what core owes its
consumers, distinguishes an intentional export from an incidental one, and can be
typechecked before an implementation exists. This package is that contract.

## Shape

| Entry                            | For                      | Status                         |
| -------------------------------- | ------------------------ | ------------------------------ |
| `@docx-editor.dev/core`          | agents, headless, server | stable                         |
| `@docx-editor.dev/core/editor`   | React / Vue adapters     | stable                         |
| `@docx-editor.dev/core/geometry` | adapter internals        | `@experimental`, semver-exempt |
| `@docx-editor.dev/core/plugin`   | extension authors        | stable                         |
| `@docx-editor.dev/core/mcp`      | MCP hosts                | stable                         |
| `@docx-editor.dev/core/types`    | everyone                 | type-only, zero runtime        |

Entries are split by audience. A headless consumer wants a document and never a
DOM type; an adapter wants an editor; an extension author wants neither, only a
stable way to contribute commands.

### Decisions worth knowing

**Addressing is `{ paraId, search }`, not a character offset.** An agent can
quote text it has seen but cannot compute an offset for text it has not, and
offsets do not survive a concurrent edit. `search` must match exactly once;
ambiguity is an error rather than first-match-wins, because silently editing the
wrong occurrence of a phrase is worse than refusing.

**Commands are open, not a sealed union.** `DocEdits` and `EditorCommands` are
interfaces widened by declaration merging, so an extension can contribute a
command without a core release. Runtime JSON Schemas ship alongside, since types
do not exist at runtime and MCP tool enumeration needs real schemas.

**Writes return `ExecResult`, not `boolean`.** A boolean cannot separate
"applied, nothing changed" from "target not found" from "target is locked", and
callers need that distinction for undo grouping, error reporting, and retries.

**`EditorSnapshot`, not `EditorState`.** `EditorState` is already a widely used
export in `prosemirror-state`, which adapters import alongside this package.

**`EditorHost` carries DOM handles, two-phase scheduling, and measurement.** The
engine paints the document and the adapter renders chrome around it, so the
engine needs handles. They are getters because they are null until first render
and can change identity afterwards. Scheduling is two-phase because the engine
coalescing its work and the adapter flushing its render are different moments.

**Scopes are explicit.** The editor manages one editing surface per header and
footer alongside the body, so an unscoped command would apply to the body while
a header has focus.

**`core/geometry` is a compatibility shelf, not a design.** It is marked
semver-exempt and is a retirement target as the shared engine absorbs its
members. Cache-invalidation functions are deliberately absent: they mutate
shared state, which breaks multiple editors on one page. Callers use
`editor.relayout({ sync: true })`.

## Status

The adapters do not compile against this contract yet. Adding this package does
not by itself make the repository typecheck; this bare declaration package is
migration inventory, not the target API authority. Replacement and adapter work
is tracked in `openspec/changes/document-engine/tasks.md`.
