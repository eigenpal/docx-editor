## Why

The `modular-core-api` change defines the engine's contracts (ports, display-list
IR, capability registry, the `DocumentStore` seam, object model) and
`chromium-free-rendering-engine` defines the shaping and PDF stages. Neither says
how a `.docx` becomes the canonical model, nor which parser reads the XML, nor how
ProseMirror binds to a model it does not own.

This change writes that pipeline down: the end-to-end path from OPC parts to a
positioned display list, expressed only in OOXML (ECMA-376) constructs and the
primitives `modular-core-api` already defines. It fixes three things those changes
leave open:

- **The parser.** `fast-xml-parser` reads every XML part, configured for OOXML
  fidelity and hardened at the trust boundary.
- **The canonical model.** One operation-based document model is the single source
  of truth. The CRDT is its backing store, not a second representation, and
  ProseMirror is a projection, not the owner. This removes the solo-vs-collab
  canonicity flip: the model is always canonical; only the store backend swaps.
- **The public shape.** The object model from `modular-core-api` pins its member
  names to the `Word.*` namespace of the widely-deployed document add-in JS API,
  so add-in code ports without a dependency on that package.

## What Changes

This change defines pipeline contracts. It builds on the runtime-ports,
display-list, capability-registry, and `DocumentStore` foundations from
`modular-core-api` and does not restate them.

- **fast-xml-parser at the trust boundary.** Every OPC part (`document.xml`,
  `styles.xml`, `numbering.xml`, `theme*.xml`, headers/footers, `*.rels`) is
  parsed by `fast-xml-parser` with `preserveOrder`, attributes kept, values
  untrimmed and uncoerced, and DTD / external-entity / entity-expansion paths
  disabled. Parsed XML nodes reach the model only through capability parsers
  (`NodeCapability.parse`), which sanitize per the security contract.
- **One canonical operation-based document model.** Parsing produces a plain
  document model that is the single source of truth, reached through the
  `DocumentStore`: `store.model` is always current, `store.apply(op)` is the only
  mutation path, and `store.subscribe` fires a block-level `ModelChange` on every
  edit. The model is PM-free and DOM-free data; what varies between solo and
  collaboration is the store backend, not the model.
- **ProseMirror is a projection, not the source of truth.** PM is still the
  editing engine: it processes every keystroke and produces transactions. An
  `EditorBinding` maps each transaction to `DocOp[]` applied via `store.apply`,
  and maps a `ModelChange` (remote edit, undo, agent edit) back into the
  `EditorState`. PM never holds canonical state. A server agent mutates the same
  store through the object model with no `EditorView` at all. This is the shape
  `y-prosemirror` already uses; the solo path just uses a local store backend.
- **Layout reads `store.model` directly.** `measure` calls the injected
  `MetricsProvider`; `paginate` splits sections, columns, tables, and
  header/footer flows; `resolve` is a second pass for page numbers, `PAGEREF` /
  TOC, and footnotes. Stages read `store.model` (always current, no conversion),
  and a `ModelChange` invalidates only the changed blocks, not the whole document.
  Output is the `DisplayItem[]` IR consumed by any `RenderBackend`.
- **Object model pinned to the `Word.*` shape.** The proxy graph, `run`,
  `RequestContext`, `load`/`sync`, and `InsertLocation` adopt the member names and
  types of the document add-in JS API (`Word.Document`, `Word.Body`,
  `Word.Paragraph`, `Word.Range`, `Word.Table`, `Word.Section`, `Word.Font`,
  `Word.Comment`, the `Collection` shape, `ClientResult<T>`). Core declares these
  types itself and takes no dependency on the add-in package. Reads project from
  `store.model`; writes queue as `DocOp`s and flush through `store.apply` on
  `sync`, which also reconciles any pending remote merge.

## Capabilities

### New Capabilities

- `ooxml-parse-boundary`: the fast-xml-parser configuration for OOXML fidelity,
  the hardening rules at the XML trust boundary, and the rule that model
  construction happens only through capability parsers.
- `canonical-document-model`: the operation-based document model reached through
  `DocumentStore` as the single source of truth, with the CRDT as a swappable
  backend and ProseMirror + display-list as projections.
- `layout-pagination-pipeline`: the `measure -> paginate -> resolve -> emit`
  stages reading `store.model`, driven incrementally by `ModelChange`, over the
  runtime ports.
- `office-compatible-object-model`: the mapping of the `modular-core-api` proxy
  graph onto the `Word.*` namespace names and types, over the store, declared in
  core without a package dependency.

### Modified Capabilities

<!-- Greenfield pipeline. The runtime-ports, display-list-ir, capability-registry,
     and document-store capabilities are defined by modular-core-api; this change
     depends on them and modifies no existing spec. -->

## Impact

- **Dependencies**: adds `fast-xml-parser` as the single XML reader, confined to
  the parse boundary. No browser XML/DOM parser on any runtime.
- **Engine boundary**: one canonical model behind `DocumentStore`; ProseMirror and
  the display list are projections of it; the CRDT is its backend. Layout reads
  `store.model` and never a ProseMirror `EditorView` or the DOM.
- **Propagation currency**: a `DocOp` is the unit of edit, undo, sync delta, and
  persistence, so keystroke, agent edit, and offline replay travel one path (the
  `remote-document-sync` change carries it).
- **Public API**: the object model's member names become `Word.*`-compatible, so
  existing add-in code ports client-side and additionally runs headless. API
  Extractor snapshots and the parity contract gain the pinned names.
- **Security**: the parse boundary is where DOCX/OOXML input is hardened (XXE,
  entity expansion, zip bomb, path traversal, external-target fetch), per the
  project security contract.
- **No runtime behavior change in this change**: the pipeline is specified as
  contracts; implementation is follow-up work.
