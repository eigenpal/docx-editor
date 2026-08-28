# Engine lane topology

The engine is ONE package, `@docx-editor.dev/core`, divided into guarded internal
lanes under `packages/core/src/`. This record covers the lane boundaries, their
responsibilities, and the rules CI enforces.

- Machine-readable source of truth: `packages/core/src/__tests__/core-lane-graph.ts`
- Enforcement (all under `bun test`):
  - `packages/core/src/__tests__/core-lane-graph.test.ts` — the DAG is acyclic,
    every lane resolves to real source, subpaths and directories are unique.
  - `packages/core/src/__tests__/browser-bundle-graph.test.ts` — walks the real
    import graph from the browser entry points, because a `package.json` rule is
    not what a bundler follows.
  - `packages/core/src/store/__tests__/prosemirror-isolation.test.ts` — PM-free
    lanes stay PM-free, by identifier and not just by import.
  - `bun run check:lane-boundaries` — compiles each runtime-neutral lane against
    its own DOM-free `tsconfig`.

## Why lanes and not packages

Eight `engine-*` workspace packages were collapsed into this one. npm enforced
those boundaries for free — a package cannot import what it does not depend on —
and that enforcement disappears the moment the code shares a directory tree. So
the same boundaries are re-declared as a rule over paths and checked in CI.

The DAG was kept identical to the package graph it replaced. A lane quietly
gaining a dependency during the move would have been a design change smuggled in
as a file move.

## Lanes

| Lane            | Directory           | Subpath           | May import                                                           | Environment |
| --------------- | ------------------- | ----------------- | -------------------------------------------------------------------- | ----------- |
| `contracts`     | `src/contracts`     | `./contracts`     | —                                                                    | neutral     |
| `store`         | `src/store`         | `./store`         | —                                                                    | neutral     |
| `collaboration` | `src/collaboration` | `./collaboration` | store                                                                | neutral     |
| `binding`       | `src/binding`       | `./binding`       | contracts, store, collaboration                                      | browser     |
| `layout`        | `src/layout`        | `./layout`        | store                                                                | neutral     |
| `output`        | `src/output`        | `./output`        | store, layout                                                        | browser     |
| `automation`    | `src/automation`    | `./automation`    | store, collaboration                                                 | neutral     |
| `editor`        | `src/editor`        | `./editor`        | contracts, store, collaboration, binding, layout, output, automation | browser     |

Responsibilities:

- **`contracts`** — declaration-only public API: `Editor`, `EditorHost`,
  commands, queries, document types.
- **`store`** — the bounded OPC/OOXML trust boundary, the canonical ordered OOXML
  tree, `TreeDocumentStore`, and the `TreeDocOp` vocabulary. The source of truth.
- **`collaboration`** — provider-neutral contracts for the document port,
  session, failure codes, and status. This lane is DOM-free. Replication
  implementations live outside core.
- **`binding`** — the ONLY ProseMirror-aware lane: projects a tree revision into
  a PM doc, and maps an edited doc back into tree ops or refuses.
- **`layout`** — resolved caches, shaping, convergent pagination, positioned
  semantic layout records. Emits geometry, never paints.
- **`output`** — the painter over those records. Never rederives geometry or
  interprets CSS.
- **`automation`** — the transport-neutral host port an automation object model
  programs against (`@docx-editor.dev/editor-api`). Store and nothing else: a
  server has to be able to run it, so reaching into binding, output or editor
  would put a DOM in a headless host.
- **`editor`** — the browser composition root. Composes the tree session,
  pagination and the paginated surface into the `Editor`/`EditorHost` contract.

Edges point downward only. A lane that acquires a new dependency declares it in
`core-lane-graph.ts`, in a diff a reviewer sees.

## Guarantees

**ProseMirror is contained to `binding`.** `contracts`, `store`,
`collaboration`, `layout` and `output` may not name a PM type or reach a PM
view. An identifier scan enforces this rule. A structural type can leak without
an import. Nothing on a headless or server path pulls in ProseMirror.

**Runtime-neutral lanes are DOM-free.** `store`, `collaboration`, `layout`, and
`automation` each have a `tsconfig.json` with a DOM-free `lib`. A `document` or
`window` reference fails type checking. The shared core configuration includes
DOM types for browser lanes. The per-lane projects stop DOM references in
runtime-neutral lanes. `contracts` includes runtime-neutral code and public
types. Its public host accessors use the `HTMLElement` type.

**A browser bundle stays a browser bundle.** `yjs`, `y-protocols`, `pdfkit`,
`node:fs`, `node:net` and `node:http` must not reach a default browser import.
The bundle-graph test follows real `import` statements through re-export barrels
to prove it, because one `export *` is enough to put a transport stack in every
consumer's bundle while every manifest still looks correct.

**Every authorable op and accepted variant is collaboration-expressible.**
Collaboration replays a canonical primitive journal onto peers, so an authorable
action that does not capture into that journal replicates to nobody. Every
`TreeDocOp` kind, and every member of the open-ended allow-list vocabularies
(`ACCEPTED_PARAGRAPH_PROPERTIES`, `ACCEPTED_RUN_PROPERTIES`,
`IMAGE_WRAP_TARGETS`, `INSERTABLE_CONTENT_CONTROL_TYPES`), MUST have a
replay-convergence fixture: `canonical-primitive-journal-coverage.test.ts`
captures the action's journal, proves it is author-deterministic, replays it
onto a fresh replica, and compares the two by fingerprint and save/reopen
digest. A property fixture also asserts its element is present in the author
tree, so a variant that converges to an empty change cannot pass. Adding an op
kind or a vocabulary member with no fixture fails that gate.

Those four vocabularies are gated at the variant level because a new member
introduces a new element or localName — a new tree shape. Enumerated attribute
values on an already-covered op (a new `w:numFmt`, a section orientation, a
transform action) are NOT separately gated: the journal lowerer is a generic
tree diff with no per-enum branching, so a new enum value replicates through the
same path its op's kind fixture already proves. A brand-new op, or one that
writes a part the journal does not capture, is still caught by the op-kind gate
and the manifest apply-path partition.

The one escape is an explicit, reasoned entry in `COLLABORATION_UNCOVERED`
(`store/store/collaboration-coverage-contract.ts`): the gate accepts a declared
reason in place of a fixture, so an action that genuinely cannot cross the
collaboration boundary is recorded and reviewed, never dropped silently. When
you add an editing capability, add its fixture, or add its reason.

## Guards must fail loudly

Every guard scans a lane by path and calls `collectSources` on the result.
`collectSources` on a missing directory returns an empty list, so a guard whose
lane moved passes having examined no files. That is not a hypothetical: the
collapse of the `engine-*` packages turned several guards into vacuous passes,
and the suite stayed green.

So every scanned path goes through `existingLanePath`, which throws when the path
does not resolve. When you move a lane, update its `directory` in
`core-lane-graph.ts` and the guards that name it — the throw tells you which.
