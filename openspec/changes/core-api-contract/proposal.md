## Why

`@docx-editor.dev/core` is now consumed as a published npm package rather than a workspace sibling, which turned an internal module boundary into a published API boundary overnight. That boundary does not survive the move: core declares 65 entry points and 1,125 public symbols, the adapters import 428 of them across 458 sites, and 12 of the subpaths they depend on are **not exported at all** (they resolved only through the monorepo `tsconfig` wildcard). Four of those unexported subpaths are ones `scripts/check-package-artifacts.mjs` already hard-fails published artifacts for importing, so the build simultaneously depends on them and rejects them.

Nothing in this repository typechecks until that boundary is defined, and no consumer can install a working core until the implementation knows what it owes.

## What Changes

- Add `packages/core` as a **contract-only** package: no implementation, `"private": true`, six declared entries. It exists so the boundary is written down, reviewed, and typechecked rather than being whatever the adapters happened to reach for.
- Declare the entry map: `core` (document layer), `core/editor` (browser facade), `core/geometry` (`@experimental`, semver-exempt), `core/plugin`, `core/mcp`, `core/types`.
- **BREAKING** (for the eventual implementation, not for this repo today): addressing becomes `{ paraId, search }` rather than offset-based. `search` must match exactly once; ambiguity is an error, never first-match-wins.
- **BREAKING**: writes return `ExecResult` rather than `boolean`, so no-op, not-found, and locked-content-control stay distinguishable.
- **BREAKING**: `EditorState` is renamed `EditorSnapshot` to stop colliding with `prosemirror-state` across 18 adapter import sites.
- Commands become open interfaces (`DocEdits`, `EditorCommands`) widened by declaration merging, paired with runtime JSON Schemas, rather than a sealed TypeScript union.
- `EditorHost` is specified at 12 members: DOM handles as getters, two-phase scheduling (`scheduleFrame` + `afterCommit`), and injected `measureBlocks`.
- `EditorScope` is explicit, because the editor is N+1 ProseMirror views (body plus one per header/footer relationship).
- Remove `docs/superpowers/`. Design records live in `openspec/`; two parallel homes for the same artifact is how they drift.

## Capabilities

### New Capabilities

- `core-public-api`: the entry map, what each entry is for, stability guarantees per entry, and the rule that no consumer may import an unexported subpath.
- `core-doc-addressing`: how a caller names a location in a document (`DocAnchor`, `DocLocation`, `ContainerRef`), and the uniqueness and failure semantics of `search`.
- `core-command-vocabulary`: commands and edits as open, declaration-merged interfaces with runtime JSON Schemas; the `ExecResult` taxonomy that every write returns.
- `core-editor-host`: the contract a framework adapter implements, including DOM-handle getters, two-phase scheduling, measurement injection, and scope semantics.

### Modified Capabilities

None. The nine existing specs under `openspec/specs/` describe core behaviours (formatting, comment ops, table resize, and so on) whose requirements are unchanged. This change defines the surface those behaviours are reached through, not the behaviours themselves.

## Impact

- **New**: `packages/core/` (contract only, private, never published).
- **Removed**: `docs/superpowers/` (8 files; the three plans and four design records there predate the migration and are superseded by `openspec/`).
- **Deferred, not included here**: migrating `packages/react`, `packages/vue`, and `packages/agents` onto this surface. That is ~458 import sites and should follow the in-flight engine unification (#696) rather than race it, since Tier 2 is the work that makes `core/geometry` retirable.
- **Blocked on**: publishing an implementation that satisfies this contract. Today npm holds only a name-reservation stub, so `bun run typecheck` cannot pass in this repo regardless of what is declared here.
- **External consumers**: `./api`, `./core-plugins`, `./mcp`, `./docx/serializer`, `./managers/AutoSaveManager`, `./plugin-api/types`, and `./utils/textSelection` have consumers outside the first-party adapters and need a deprecation window rather than a straight cut.
