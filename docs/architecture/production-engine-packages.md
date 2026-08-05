# Production engine package topology

Authoritative record for **document-engine task 1.4**: the production
implementation package boundaries, their responsibilities, and the dependency
rules enforced in CI.

- Machine-readable source of truth: `packages/engine-core/test/package-graph.ts`
- Enforcement: `packages/engine-core/test/import-graph.test.ts` (runs under `bun test`)

## Placement

The production engine is implemented **in this monorepo** as new workspace
packages under `packages/engine-*`. This supersedes the earlier "source is not in
this tree" note. `packages/core` (`@docx-editor.dev/core`) remains the
private declaration-only contract — no production package imports its
implementation. The old spike architecture that once sat under
`packages/core/spike` has been removed now that the production lanes carry the
behavior it was built to justify; ADR-S9's isolation rule retired with it.

The semantic core ships internally as `@docx-editor.dev/engine-core` during the
greenfield build and becomes the published `@docx-editor.dev/core` at the section
7/14 public-namespace and adapter-migration milestone, so the in-tree package
does not collide with the `@docx-editor.dev/core` alias adapters resolve today.

## Packages and responsibilities

| Package | Responsibility | May import | DOM |
| --- | --- | --- | --- |
| `@docx-editor.dev/engine-core` | Bounded OPC/OOXML trust boundary, canonical authored package model, `DocumentStore`, `DocOp`/`ModelChange` contracts, opaque anchors, history, `DocxEditor.*` dispatch/registry, ports & budgets | — | no |
| `@docx-editor.dev/engine-binding` | The **only** ProseMirror-aware integration: PM transactions ⇄ `DocOp`s, view reconciliation from `ModelChange` | core | yes |
| `@docx-editor.dev/engine-sync` | Local + Yjs `ReplicatedStoreBackend`, the sole `ReplicationCoordinator`, relative-position anchors, snapshots, persistence, awareness | core | no |
| `@docx-editor.dev/engine-layout` | Resolved caches, dependency closure, shaping, convergent pagination, anchored `DisplayItem[]` IR | core | no |
| `@docx-editor.dev/engine-output` | DOM paint, print, native PDF, a11y projection, hit-testing over `DisplayItem[]` | core, layout | yes |
| `@docx-editor.dev/engine-server` | Addressable-sync hub, versioned RPC, headless parse/edit/layout/save/export, tenant isolation, streaming | core, sync, layout, output | no |
| `@docx-editor.dev/engine-clients` | Generated language clients (schema bindings only) | core | no |
| `@docx-editor.dev/engine-editor` | Browser editor composition root: the production `createEditor`; composes the PM-free binding surface + layout + display into the PM-free `Editor`/`EditorHost` contract. Becomes `@docx-editor.dev/core/editor` at migration | core, binding, layout, output | yes |

## Dependency rules (the DAG)

```
engine-core            (base; depends on nothing internal)
  ├── engine-binding   (+ prosemirror-*)
  ├── engine-sync      (+ yjs, y-protocols)
  ├── engine-layout    (+ shaping/font/unicode libs)
  │     └── engine-output   (+ pdf-lib/pdfkit; DOM backends)
  ├── engine-server    (composes sync + layout + output; + transport)
  ├── engine-clients   (generated)
  └── engine-editor    (composes binding + layout + output; PM-free browser editor)
```

`engine-editor` is the only package above the binding/layout/output trio. It is
PM-free: it composes `engine-binding`'s PM-free edit surface and never imports
`prosemirror-*` directly, so ProseMirror stays contained to `engine-binding`.
`engine-server` deliberately does NOT depend on `engine-binding`, so no headless
/ server path transitively pulls in ProseMirror.

Edges point "downward" only: no package imports a sibling not listed in its
`internalDeps`, so `engine-core` can never depend on `engine-sync`,
`engine-layout` can never depend on `engine-output`, and so on.

## Semantic-core guarantees (task 1.4 named invariants)

`engine-core` is:

- **PM-free** — no `prosemirror-*` import.
- **DOM-free** — its `tsconfig` omits the `DOM` lib, so any `document`/`window`
  use fails to typecheck; no `jsdom`/`linkedom`/`happy-dom` import.
- **Yjs-free** — no `yjs`/`y-*` import (Yjs lives entirely in `engine-sync`).
- **transport-neutral** — no `ws`/`socket.io`/`http`/`net`/`tls`/`fetch`
  transport import.
- **PDF-free** — no `pdf-lib`/`pdfkit`/`pdfjs` import (PDF lives in
  `engine-output`).

These are enforced by scanning real source and each package manifest in the
import-graph test, plus the structural DOM-free tsconfig check.
