## Context

Core is consumed as a published npm package rather than a workspace sibling. The boundary between it and its consumers was never designed, because until now there was no boundary: everything resolved through one `tsconfig`.

Measured across both trees:

| | |
| --- | --- |
| Declared entry points | 65 |
| Distinct public symbols | 1,125 (631 fn, 291 iface, 106 const, 77 type, 21 class) |
| Subpaths adapters import | 65 |
| Distinct symbols adapters import | 428, across 458 sites |
| Subpaths imported but never exported | 12, carrying 86 symbols across 73 sites |

Three facts constrain any design here:

1. **The leak is a packaging bug before it is an API problem.** `flow-model`, `pagination-model`, `painter-model`, and `editor` resolve only via the `tsconfig` wildcard, and `scripts/check-package-artifacts.mjs` already hard-fails published artifacts that import them. The build depends on them and rejects them at once.
2. **There is no verification gate today.** `bun run typecheck` cannot pass: npm holds only a name-reservation stub for core. Neither the current surface nor any proposed surface can be validated by running it.
3. **Core calls back into the adapter to lay out.** `computeLayout` takes `measureBlocks` as an input and both adapters supply their own. A self-contained `Editor` cannot exist until that inverts.

This design was produced by drafting a surface, then subjecting it to a six-lens expert review (API design, OOXML domain, adapter integration, agent/MCP, migration risk, adversarial) with independent adversarial verification of every blocker and major finding. Twenty-eight of forty-three objections survived. The first draft was rejected 4 RETHINK to 2 SHIP_WITH_CHANGES; the decisions below are the corrections.

## Goals / Non-Goals

**Goals:**

- Declare a boundary small enough to maintain across a package boundary and honest enough that no consumer needs to reach around it.
- Make the contract typecheckable in this repository before any implementation exists.
- Keep every symbol adapters use today reachable, so nothing is deleted without a replacement.
- Serve three distinct consumers (document/headless, browser adapters, agents and MCP) without forcing any of them through the others' surface.

**Non-Goals:**

- Migrating the adapters onto this surface. That is ~458 import sites and belongs after the in-flight engine unification.
- Implementing anything. This change adds declarations only.
- Redesigning layout, pagination, or painting algorithms.
- Removing `core/geometry`. It is a compatibility shelf with a stated retirement path, not a design.

## Decisions

**1. Six entries, not four.** The first draft proposed four and was sized against an 86-symbol undercount; the real figure is 428. Splitting `geometry` and `mcp` out of the original three keeps each entry's audience coherent: document consumers never see paint functions, and MCP hosts never see DOM types. *Alternative considered:* four entries with geometry folded into `editor`, rejected because it makes the stable entry carry a semver-exempt surface.

**2. Addressing is `{ paraId, search }`, not `{ blockId, offset }`.** Offset addressing already exists in `types/agentApi.ts` as a 15-member `AgentCommand` union, and the agents package uses none of it. A model cannot compute an offset for text it has not seen, and offsets do not survive concurrent edits. Uniqueness is enforced rather than first-match-wins, because a silent wrong-match in a legal document is worse than a failure. *Alternative considered:* offsets with a repair pass, rejected as unfixable for the agent case.

**3. Commands are open interfaces, not a sealed union.** A sealed union cannot be widened by a plugin, and the runtime dispatch is already registry-backed via `ExtensionManager`'s `CommandMap`. Declaration merging gives extension authors type safety without patching core. Runtime JSON Schemas ship alongside, because a union vanishes at compile time and `tools/list` needs real schemas. *Alternative considered:* a closed union with an `unknown` escape hatch, rejected as the status quo with extra steps.

**4. Writes return `ExecResult`, not `boolean`.** A boolean flattens no-op, not-found, ambiguous, and locked into one value. The editor layer already throws eight distinct content-control error classes across eleven sites; a boolean discards all of it. The `changed` flag preserves the no-op distinction callers need for undo grouping.

**5. `EditorSnapshot`, not `EditorState`.** `EditorState` collides with `prosemirror-state`'s export across 18 adapter import sites, several already aliasing around it. Reads are also parameterized through `query(...)` rather than served by one god-blob, so a caller pays only for what it asks.

**6. `EditorHost` has 12 members.** The first draft said three. Verified against the real adapters, three is not close: the engine paints the DOM, so it needs handles; those handles are null on first render, so they must be getters; and the adapter's commit is a different moment from the engine's paint, so scheduling is two-phase. This restores the `EngineHost` contract already derived in `openspec/changes/engine-spine-tier2/`, plus `afterCommit`.

**7. `EditorScope` is explicit.** The editor is N+1 ProseMirror views. Without a scope on every command, a command issued while a header has focus silently hits the body.

**8. Cache invalidation leaves the public surface.** `clearAllCaches`, `resetCanvasContext`, `invalidateHfDomCache`, and the IME anchor resets mutate module-scope state. Exposing them defeats the facade and breaks two editors on one page. Core takes ownership of the `document.fonts` `loadingdone` listener that currently drives them from the React adapter, which incidentally fixes Vue, where no font-load invalidation happens at all.

## Risks / Trade-offs

- **The contract cannot be validated until an implementation exists.** → Keep it declaration-only and typechecked in isolation, so at minimum it is internally consistent; treat the first implementation as the real review.
- **`core/geometry` could calcify into a permanent second API.** → Mark it `@experimental` and semver-exempt, document it as a retirement target, and tie its removal to engine-unification milestones rather than leaving it open-ended.
- **Declaration merging is less discoverable than named exports.** → Ship runtime schemas and keep the built-in command set enumerable, so tooling and docs can list commands without reading types.
- **A two-package refactor cannot be gated by the e2e suite.** → All 152 specs live with the consumers; core changes cannot be validated against them atomically. Sequence the adapter migration after engine unification, when the surface is narrower.
- **`private: true` is the only thing preventing a catastrophic publish.** → A published contract package would shadow the real one with throwing functions. Verify exclusion in the release workflow, not just the manifest.

## Migration Plan

1. Land the contract package. No consumer changes; nothing compiles against it yet.
2. Publish an implementation satisfying the stable entries, keeping the seven externally consumed legacy entries resolvable as deprecated aliases.
3. Finish engine unification (#696) in the tree where it is still atomic and the e2e suite runs.
4. Migrate adapters entry by entry, `core/geometry` last, shrinking it as engine work absorbs its members.
5. Remove the legacy aliases one major after their replacements ship.

Rollback: the contract package is private and has no dependents, so reverting is deleting a directory.

## Open Questions

- Does `measureBlocks` retire with engine unification, or is adapter-supplied measurement permanent? This determines whether `EditorHost` can shrink below 12.
- Do the ~16 toolbar and widget symbols (`IMAGE_LAYOUT_OPTIONS`, the TOC refresh cluster, `detectTableInsertHover`) move into a shared module beside the adapters, now that react, vue, and agents share a tree? That would remove them from the contract entirely.
- Should `core/mcp` ship the tool registry, or only the schemas, leaving transport to the host?
- What is the deprecation window in practice for the seven externally consumed entries, given no telemetry on who uses them?
