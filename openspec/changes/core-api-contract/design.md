## Context

`@docx-editor.dev/core` is a published dependency of the adapters in this repository. Its public surface has never been declared, so there is no agreement on what it owes consumers and nothing for those consumers to typecheck against.

Three constraints shape the design:

1. **Three distinct audiences.** A headless or agent consumer wants a document: parse, inspect, edit, write back, no DOM. A framework adapter wants an editor: layout, paint, selection, geometry. An extension author wants neither, only a stable way to contribute commands. Serving all three through one undifferentiated surface forces each to see the others' concerns.
2. **The engine paints the DOM.** The adapter does not render the document; it hosts a surface the engine paints into, then renders its own chrome around it. That inverts the usual component relationship and drives most of what `EditorHost` must provide.
3. **Agents address documents over a wire.** Commands and positions cross JSON boundaries, so neither can be an object reference, a live handle, or an index the caller had to compute.

## Goals / Non-Goals

**Goals:**

- Declare a boundary small enough to maintain across a package boundary and complete enough that no consumer needs to reach around it.
- Make the contract typecheckable before any implementation exists.
- Keep every capability the adapters rely on reachable, so nothing is removed without a replacement.
- Serve document consumers, browser adapters, and agents without forcing any through the others' surface.

**Non-Goals:**

- Implementing anything. This change adds declarations only.
- Pointing the adapters at this surface. That is its own sequence.
- Redesigning layout, pagination, or painting algorithms.
- Treating `core/geometry` as permanent. It is a compatibility shelf with a stated retirement path.

## Decisions

**1. Six entries, split by audience.** `core` for documents, `core/editor` for the browser, `core/geometry` for adapter internals, `core/plugin` for extension authors, `core/mcp` for tool hosts, `core/types` for types alone. *Alternative considered:* folding geometry into `core/editor`, rejected because it would make a stable entry carry a semver-exempt surface.

**2. Addressing is a paragraph id plus a unique phrase.** An agent can quote text it has seen; it cannot compute a character offset for text it has not, and offsets do not survive a concurrent edit. Uniqueness is enforced rather than resolved first-match-wins: in a contract or filing, silently editing the wrong occurrence is worse than refusing. `DocLocation` covers content that carries no paragraph id, such as table cells and nested content controls. *Alternative considered:* offsets with a repair pass, rejected as unreliable for the agent case.

**3. Commands are open interfaces, not a sealed union.** A sealed union cannot be widened by a third party, so every extension would require a core release. Declaration merging gives extension authors type safety without patching core, and runtime JSON Schemas ship alongside because types do not exist at runtime and MCP tool enumeration needs real schemas. *Alternative considered:* a closed union with an escape hatch for unknown commands, rejected as untyped dispatch wearing a type.

**4. Writes return `ExecResult`.** A boolean cannot separate "applied, nothing changed" from "target not found" from "target is locked". Callers need that distinction for undo grouping, for surfacing errors, and for agents deciding whether to retry. The `changed` flag preserves the no-op case explicitly.

**5. Reads are parameterized, and the snapshot is not the only read.** `query(...)` answers specific questions; `snapshot()` returns what chrome needs to render itself. A single zero-argument state object cannot express reads that take arguments, such as resolving the hyperlink at a position.

**6. `EditorSnapshot`, not `EditorState`.** `EditorState` is already the name of a widely used export in `prosemirror-state`, which adapters import alongside this package. Colliding on it forces aliasing at every call site.

**7. `EditorHost` carries DOM handles, two-phase scheduling, and measurement.** Handles are getters because they are null until the adapter first renders and can change identity afterwards. Scheduling is two phases because the engine coalescing its own work and the adapter flushing its render are different moments; conflating them means painting against stale geometry. Measurement is injected so the host controls caching and a headless host can supply its own.

**8. Scopes are explicit.** The editor manages one editing surface per header and footer alongside the body. Without a scope on every command, a command issued while a header has focus silently applies to the body.

**9. Cache invalidation is not public.** Functions that reset shared measurement or paint state cannot be exposed without breaking the facade and breaking two editors on one page. The engine owns font-load invalidation itself, and callers get `relayout` instead.

## Risks / Trade-offs

- **The contract cannot be validated until an implementation exists.** → Keep it declaration-only and typechecked in isolation so it is at least internally consistent, and treat the first implementation as the real review.
- **`core/geometry` could calcify into a permanent second API.** → Mark it `@experimental` and semver-exempt, document it as a retirement target, and tie its removal to engine-consolidation milestones rather than leaving it open-ended.
- **Declaration merging is less discoverable than named exports.** → Ship runtime schemas and keep the built-in command set enumerable, so tooling and docs can list commands without reading types.
- **A change spanning two packages cannot be gated by one end-to-end run.** → Sequence the adapter work after the shared engine consolidates, when the surface is narrower.
- **`private: true` is the only thing preventing a damaging publish.** → A published contract package would shadow the real one with throwing functions. Assert the exclusion in the release workflow, not only in the manifest.

## Migration Plan

1. Land the contract package. No consumer changes; nothing compiles against it yet.
2. Publish an implementation satisfying the stable entries, keeping legacy entries resolvable as deprecated aliases.
3. Consolidate the shared editor engine, which is what makes `core/geometry` shrinkable.
4. Point the adapters at the new surface entry by entry, `core/geometry` last.
5. Remove the deprecated aliases one major after their replacements ship.

Rollback: the contract package is private and has no dependents, so reverting is deleting a directory.

## Open Questions

- Does injected measurement retire once the engine consolidates, or is adapter-supplied measurement permanent? This determines whether `EditorHost` can shrink.
- Should the toolbar and widget helpers shared between the React and Vue adapters live beside those adapters rather than in the contract, now that both are in one tree?
- Should `core/mcp` ship the tool registry, or only the schemas, leaving transport to the host?
- What is the deprecation window in practice for the legacy entries, given no telemetry on who uses them?
- `getCurrentPage` can mean the page in the viewport or the page holding the caret. The contract takes a `mode` argument, which defers rather than answers it; a default should be chosen.
