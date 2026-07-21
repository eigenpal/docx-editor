## Context

`modular-core-api` gives the contracts and `chromium-free-rendering-engine` gives
the shaping and PDF stages. This design connects them into one pipeline and fixes
the three things they leave open: the parser, the canonical model, and the public
member names. It is interface-only. It references only ECMA-376 OOXML constructs
and the primitives `modular-core-api` defines (`RuntimePorts`, `MetricsProvider`,
`DisplayItem`, `RenderBackend`, `NodeCapability`, `DocumentStore`, `DocOp`,
`ModelChange`, `EditorBinding`, `RequestContext` and the proxy graph).

## Model-canonical, one source of truth

The document model is always canonical, reached through `DocumentStore`.
ProseMirror and the display list are projections of it; the CRDT is its backend.
There is no representation that is canonical "sometimes": solo and collaboration
differ only in which store backend is installed.

```ts
// THE canonical store. modular-core-api owns this contract.
interface DocumentStore {
  readonly model: DocumentModel                      // canonical, always current
  apply(op: DocOp, origin?: unknown): void           // the ONLY mutation path
  subscribe(cb: (change: ModelChange, origin: unknown) => void): () => void
  encode(): Uint8Array                               // persistence / propagation
  merge(update: Uint8Array, origin?: unknown): void  // remote delta in
}

// ProseMirror is a projection, never canonical.
interface EditorBinding {
  bind(store: DocumentStore, view: EditorView): () => void
  // init:  model -> EditorState
  // local: PM transaction -> DocOp[] -> store.apply
  // store change (remote / undo / agent) -> reconcile EditorState
}
```

- **Solo:** a plain in-memory op-log backs the store. PM keystrokes become
  `DocOp`s applied to the model.
- **Collab:** the `CrdtBackend` from `remote-document-sync` is a `DocumentStore`
  implementation. `apply` maps to a `Y.Doc` transaction, `merge` applies a remote
  delta, `subscribe` fires on local and remote change. Same path, different
  backend. This is what `y-prosemirror` already does; the solo path just reuses
  the shape.

## Pipeline

```
.docx (OPC zip)
  │  unzip  (ratio cap, size cap, reject "../" and leading "/" in part paths)
  ▼
OPC parts:  document.xml  styles.xml  numbering.xml  theme*.xml
            header*/footer*.xml  *.rels  media/*
  │  fast-xml-parser  (preserveOrder, attrs kept, values raw, DTD/entities off)
  ▼
XML node trees (one per part)
  │  NodeCapability.parse  (per-type parsers; sanitize hrefs/CSS, resolve rels,
  │                         inert field codes)  -> initial DocOps / model seed
  ▼
┌──────────────────────────────────────────────────────────────────┐
│  DocumentStore                                                     │
│   store.model  (canonical DocumentModel: resolved styles ·        │
│                 numbering · section geometry · part refs)         │
│   store.apply(op) · subscribe(ModelChange) · encode · merge       │
│   backend: solo op-log  |  collab CrdtBackend (Yjs)               │
└──────────────────────────────────────────────────────────────────┘
     ▲ apply(DocOp)                 │ store.model (read)        │ subscribe(ModelChange)
     │                              ▼                           ▼
  ProseMirror (projection)     LAYOUT (reads store.model)   incremental invalidation
  editing engine: keystroke    measure -> paginate ->       (only changed blocks
  -> transaction -> DocOp;      resolve -> emit               re-measured)
  EditorBinding reconciles         │
  on ModelChange.                   ▼
  (client only; agents             DisplayItem[]  ->  DOM | PDF | print | hit-test
  apply DocOps with no view)
```

The server path drops the ProseMirror box: an agent calls the object model, which
issues `DocOp`s to the store; layout reads `store.model`; the PDF backend emits.
No `EditorView`, no DOM.

## Decisions

### D1 - fast-xml-parser is the only XML reader, configured for OOXML fidelity

OOXML is order-significant, attribute-heavy, and whitespace-significant. The
parser is configured so no fidelity is lost between bytes and model:

| Option | Value | Why |
| --- | --- | --- |
| `preserveOrder` | `true` | run/child order in `w:p`, `w:tbl` is content, not a set |
| `ignoreAttributes` | `false` | every OOXML property is an attribute (`w:val`, `w:w`, ...) |
| `trimValues` | `false` | `w:t` with `xml:space="preserve"` must keep spaces |
| `parseTagValue` / `parseAttributeValue` | `false` | keep `"0100"`, `"000000"` as strings, never coerce to number |
| `processEntities` | limited to the five predefined XML entities | no custom/DTD entity expansion |
| DTD / external entities | rejected | no XXE, no billion-laughs |
| `attributeNamePrefix` | fixed sentinel | stable attribute keys for the parsers |

The parser runs behind a bounded reader: total decompressed size and per-part
ratio are capped before parsing, and entity-expansion depth is bounded. These are
the XML-safety and zip-safety guards from the project security contract, and they
live here because this is the trust boundary.

### D2 - Model construction only through capability parsers

Raw parsed XML nodes never reach the model directly. Each content and mark type
supplies a `NodeCapability.parse(xml, ctx)` (the registry from `modular-core-api`
D4). That parser is the single place a file-derived value is sanitized: hrefs
through `sanitizeHref`, CSS-bound strings escaped, external `TargetMode`
relationships left unresolved (no zero-click fetch), field instructions rendered
inert. A type whose capability is absent is skipped, so core parses a file whose
feature is not installed.

### D3 - The canonical model is operation-based, reached through the store

`store.model` is the single source of truth and is always current. It is plain
data (no ProseMirror node, no DOM node, no CSS) and carries what measurement
needs so `measure` is a pure function of `(store.model, ports)`: resolved style
chains (no cascade at measure time), numbering counter state, section geometry,
and part references the ports resolve. Determinism of these inputs is what lets
the same model paginate identically in browser, worker, and server.

Every mutation is a `DocOp` applied via `store.apply`. A `DocOp` is the
serializable, anchor-addressed edit vocabulary from `core-api-contract`
(`DocEdits` / `EditorCommands`, `{ type, ...args }` over `DocAnchor`), so one
currency serves edit, undo, sync delta, and persistence. `store.subscribe`
reports a block-level `ModelChange` so consumers invalidate incrementally rather
than diffing the whole document.

The model's shape mirrors the office-js Word object model: a `Document` with
`body` and `sections`, a `Body` with `paragraphs`/`tables`/`inlinePictures`, a
`Paragraph` with `font`/`style`/`alignment`/`listItem`, a `Range`, a `Table` with
`rows` and cells, a `Font` with `bold`/`italic`/`underline`/`color`/`size`/`name`.
Because the model already carries those names, the object-model proxy graph (D5)
is a thin lazy facade over it, not a translation layer.

### D4 - ProseMirror is a projection via `EditorBinding`, never canonical

PM remains the editing engine on the client: it processes keystrokes, IME, and
selection and produces transactions. `EditorBinding` maps each transaction to
`DocOp[]` applied to the store, and maps an inbound `ModelChange` (remote edit,
undo, or agent edit) back into the `EditorState`. PM holds no canonical state;
its history is not the source of undo (the store's op log / CRDT is). Layout
never reads the `EditorView` or its DOM; it reads `store.model`.

This deletes the earlier `DocumentSource.current(): Node` contradiction and the
whole-document project-on-every-layout step. The honest cost is a bidirectional
PM/op mapping (transaction -> `DocOp`, `ModelChange` -> PM reconcile), essentially
a `y-prosemirror`-equivalent for our model. The prior one-way whole-doc project
step was already half of that work done less efficiently; this upgrades it to
incremental and bidirectional rather than adding a new burden. It requires the
model to support cheap structural sharing so `ModelChange` invalidation is real.

### D5 - Object model member names track the `Word.*` namespace, over the store

`modular-core-api` fixes the paradigm (`run` / `RequestContext` / `load` / `sync`
/ proxy graph). This change pins the names and types to the document add-in JS API
so add-in source ports unchanged. Core declares the types; it does not import the
add-in package. Reads project from `store.model`; writes queue as `DocOp`s and
flush through `store.apply` on `sync`, which is also where a pending remote
`merge` is reconciled.

| `modular-core-api` proxy | `Word.*` name adopted | Notes |
| --- | --- | --- |
| `run(fn)` | `run(fn)` (shape of `Word.run`) | app-scoped batch |
| `RequestContext` | `Word.RequestContext` | `document`, `sync()`, `load()`, `trackedObjects` |
| `DocumentProxy` | `Word.Document` | `body`, `sections`, `save()`, `getFileAsync('docx')` |
| `BodyProxy` | `Word.Body` | `paragraphs`, `tables`, `insertParagraph`, `getRange` |
| `ParagraphProxy` | `Word.Paragraph` | + `Word.ParagraphCollection` |
| `RangeProxy` | `Word.Range` | `text`, `font`, `insertText`, feature anchor |
| `TableProxy` | `Word.Table` | + `Word.TableCollection` |
| `SectionProxy` | `Word.Section` | + `Word.SectionCollection` |
| `FontProxy` | `Word.Font` | on `Range`/`Paragraph` |
| `CommentProxy` | `Word.Comment` | present only if collaboration installed |
| collection shape | `.items` / `getFirst()` / `getItem(i)` | lazy, `load`-materialized |
| result wrapper | `ClientResult<T>` (`.value`) | returned by async getters |
| location enum | `InsertLocation` (`Before/After/Start/End/Replace`) | insert positioning |

Superset over the add-in original: the same code additionally runs headless
(worker/server) against a document with no host application, mutating the same
store, which the client-only add-in API cannot do.

## Risks / Trade-offs

- **Bidirectional PM/op mapping is real work** (D4) → scope it as the one binding
  every backend reuses; a golden test asserts transaction -> `DocOp` -> model and
  `ModelChange` -> `EditorState` round-trip.
- **fast-xml-parser `preserveOrder` output is verbose** (array-of-objects with a
  `:@` attribute bag) → keep it behind the capability parsers; the model never
  exposes the parser's node shape.
- **Whitespace and number coercion are easy to get wrong** → `trimValues:false`
  and `parseTagValue:false` are load-bearing; a round-trip fixture asserts
  `xml:space="preserve"` and zero-padded values survive.
- **Incremental invalidation depends on structural sharing** → the model must
  share unchanged subtrees so a `ModelChange` names a small block set; without it
  `ModelChange` degrades to whole-doc re-measure.
- **`Word.*` surface is large** → adopt names for the subset the proxy graph
  needs, not the full namespace; grow by demand.

## Open Questions

- The `DocOp` granularity: mark toggles and structural edits as distinct op types
  vs one splice op with attributes.
- Which OOXML parts get a streaming reader vs full parse (large `document.xml`).
- Whether the model stores resolved-and-raw style values or resolved-only (raw
  needed for lossless save; resolved needed for measure).
- How much of the `Word.*` surface to declare now vs on first consumer need.
