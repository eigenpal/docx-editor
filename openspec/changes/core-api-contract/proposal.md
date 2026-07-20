## Why

`@docx-editor.dev/core` is a published dependency of the adapters in this repository, but its public surface has never been declared. Without a written contract there is no agreement on what core owes its consumers, no way to tell an intentional export from an incidental one, and nothing for a consumer to typecheck against.

This change writes that contract down so it can be reviewed and enforced before implementation work depends on it.

## What Changes

- Add `packages/core` as a **contract-only** package: declarations only, no implementation, `"private": true` so it can never be published.
- Declare six entries, one per consumer audience: `core` (document layer), `core/editor` (browser facade), `core/geometry` (adapter internals, `@experimental`), `core/plugin` (extension authoring), `core/mcp` (MCP tool registry), `core/types` (type-only barrel).
- Specify anchor-based addressing (`DocAnchor`, `DocLocation`) where a caller names a paragraph and a unique phrase rather than computing a character offset. Ambiguous matches are an error, never first-match-wins.
- Specify commands and edits as open interfaces widened by declaration merging, paired with runtime JSON Schemas so MCP hosts can enumerate them.
- Specify `ExecResult` as the return of every write, so a no-op, a missing target, and a locked content control stay distinguishable.
- Specify `EditorHost` as the full contract a framework adapter implements: DOM handles as getters, two-phase scheduling, and injected measurement.
- Specify `EditorScope`, since the editor manages one editing surface per header and footer alongside the body.
- Exclude cache-invalidation functions from the public surface; callers use `relayout` instead.
- Remove `docs/superpowers/`. Design records belong in `openspec/`, and two parallel homes for the same artifact is how they drift.

## Capabilities

### New Capabilities

- `core-public-api`: the entry map, what each entry is for, per-entry stability guarantees, and the rule that no consumer resolves core through a path mapping.
- `core-doc-addressing`: how a caller names a location (`DocAnchor`, `DocLocation`, `ContainerRef`), and the uniqueness and failure semantics of `search`.
- `core-command-vocabulary`: commands and edits as open, declaration-merged interfaces with runtime JSON Schemas, and the `ExecResult` taxonomy every write returns.
- `core-editor-host`: the contract a framework adapter implements, covering DOM handles, scheduling, measurement, and scope semantics.

### Modified Capabilities

None. The existing specs under `openspec/specs/` describe behaviours whose requirements are unchanged. This change defines the surface those behaviours are reached through, not the behaviours themselves.

## Impact

- **New**: `packages/core/` — contract only, private, never published.
- **Removed**: `docs/superpowers/`.
- **Not included**: pointing `packages/react`, `packages/vue`, and `packages/agents` at this surface. That is a large mechanical change and belongs in its own sequence, after the shared editor engine consolidates.
- **Depends on**: an implementation that satisfies the stable entries. Until one is published, this repository cannot typecheck against the contract.
- **Compatibility**: several entries have consumers outside the first-party adapters and need a deprecation window rather than a straight cut.
