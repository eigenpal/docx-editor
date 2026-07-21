## Context

This is a greenfield document engine. The design target is a small,
environment-agnostic core whose primary public surface is a batched proxy
object-model API, with features and output formats as opt-in packages around it.
Prior art in this codebase (a monolithic engine, browser-tethered glyph
measurement, browser-only output, features woven into shared pipelines) is the
motivation to build the boundaries right from the start, not the thing being
wrapped.

This design defines the **contracts** for that engine, plus the seams that let
features and output formats live in opt-in packages. It is interface-only: no
implementation lands in this change.

The API paradigm chosen is a **batched proxy request-context object model** — an
application-scoped `run(context => { ... })`, lazy proxy objects whose properties
must be explicitly `load`ed and materialized by `context.sync()`, and mutations
queued on the context and flushed on `sync`. This is the shape of the
widely-deployed document add-in JavaScript object model, deliberately chosen for
**source compatibility**: applications written against that model should run
against our engine.

That add-in object model is **client-side only** — it runs inside an add-in web
runtime hosted by a desktop/web document application, bridging a web app to a
live host document. Its batched design exists precisely to marshal calls across
that async host boundary. We exploit the same property to expose a **superset**:
source-compatible on the client, and additionally runnable **headless** (worker
or server) against a document with no UI, which the original client API cannot
do. The runtime differences are absorbed entirely by the ports (D2).
(Brand name intentionally omitted from repo content per project convention; see
Open Questions on whether to name it and target source-compatibility explicitly.)

## Goals / Non-Goals

**Goals:**

- One stable, batched, high-level public API (the object model) as core's primary
  surface, with the current low-level exports demoted to internals behind it.
- Remove the single browser tether so layout is deterministic and runs unchanged
  in browser, worker, or server (ports and adapters).
- One positioned IR consumed by every output target (DOM, PDF, Markdown, print,
  hit-test), so exporters never re-derive geometry or interpret CSS.
- A plug-in surface below ProseMirror so features register their
  parse/serialize/measure/paint behavior and core can compile with a feature
  absent.
- Confine heavy dependencies (font shaping, PDF emit) to the packages that need
  them; keep them out of the browser editor bundle.

**Non-Goals:**

- No implementation, file moves, or package extraction in this change.
- No change to document-fidelity (OOXML) rendering behavior.
- No real-time multi-user editing package; only the `DocumentStore` backend seam
  is reserved for it.
- No collaborative-document library dependency in core.

## Decisions

### D1 — Public API is a batched proxy object model, not direct mutators

`run` opens a `RequestContext`; consumers navigate proxy objects, declare what
they need with `load`, and materialize with `sync`. Reads project from
`store.model`; mutations queue and flush as `DocOp`s through `store.apply` on
`sync`, which is also where a pending remote `merge` is reconciled. This gives a
stable contract over the canonical model (D5), batches work (one reflow per
`sync`, not per mutation), and is transport-neutral (the same shape works across
an iframe/worker/RPC boundary later).

```ts
function run<T>(fn: (context: RequestContext) => Promise<T>): Promise<T>

interface RequestContext {
  readonly document: DocumentProxy
  load(object: ClientObject, properties?: string | string[]): void
  sync(): Promise<void>
  trackedObjects: { add(o: ClientObject): void; remove(o: ClientObject): void }
}

interface DocumentProxy extends ClientObject {
  readonly body: BodyProxy
  readonly sections: ClientCollection<SectionProxy>
  readonly comments: ClientCollection<CommentProxy>   // present only if collaboration is loaded
  save(): void
  getFileAsync(format: 'docx'): ClientResult<Uint8Array>
}
interface BodyProxy extends ClientObject {
  text: string                                        // loadable
  readonly paragraphs: ClientCollection<ParagraphProxy>
  readonly tables: ClientCollection<TableProxy>
  insertParagraph(text: string, location: InsertLocation): ParagraphProxy
  getRange(): RangeProxy
}
interface RangeProxy extends ClientObject {
  text: string
  font: FontProxy
  insertText(text: string, location: InsertLocation): RangeProxy
  // range is the anchor a feature (e.g. comments) attaches to
}
```

**Alternative considered:** a synchronous imperative API over the live PM state.
Rejected: it leaks the internal model, cannot batch, and cannot cross a
worker/host boundary — foreclosing the server and add-in-host directions this
whole effort is about.

### D2 — Ports and adapters remove the browser tether

Core declares `MetricsProvider` / `FontProvider` / `ImageProvider`; the runtime
supplies an adapter set. The measurement path stops calling `getCanvasContext()`
directly and calls the injected `MetricsProvider`. Contained to one file plus two
call sites (`canvasWidth`, `readFontBoundingBox`), because the rest of the engine
is already behind `FontStyle`/`FontMetrics` interfaces.

```ts
interface MetricsProvider { advance(text: string, font: FontStyle): number
                            verticalMetrics(font: FontStyle): VMetrics | null }
interface FontProvider    { resolve(family: string, style: FontStyle): ResolvedFont
                            bytes(font: ResolvedFont): Uint8Array | null }
interface ImageProvider   { decode(ref: ImageRef): DecodedImage }
interface RuntimePorts { metrics: MetricsProvider; fonts: FontProvider; images: ImageProvider }
```

Browser adapter = canvas + system fonts + `<img>`. Headless adapter =
font-shaping + embedded/fallback fonts + decode. **Alternative:** keep canvas and
run a headless browser for server output. Rejected: carries a full browser per
request and makes layout depend on server-installed fonts.

### D3 — Display list is a first-class IR; outputs are backends

The layout engine emits an immutable `DisplayItem[]`; each output implements
`RenderBackend`. Glyph x-positions come from measured advances the engine already
computes, so a backend draws positioned primitives and never interprets CSS.

```ts
type DisplayItem =
  | { kind: 'glyphRun'; x: number; y: number; advances: number[]; text: string
      font: ResolvedFont; fill: Color; decoration?: Deco }
  | { kind: 'rect';   box: Box; fill?: Color; stroke?: Stroke }
  | { kind: 'image';  box: Box; source: ImageRef; transform?: Matrix }
  | { kind: 'link';   box: Box; target: { uri: string } | { dest: BookmarkId } }
  | { kind: 'anchor'; box: Box; featureKey: string; payload: unknown }  // feature overlays
interface RenderBackend { beginPage(g: PageGeometry): void; draw(i: DisplayItem): void; end(): void }
```

The `anchor` item lets a feature contribute a positioned overlay (comment range,
change bar) with core carrying `featureKey`/`payload` opaquely.

### D4 — Capability registry replaces type switches

Content/mark types register pipeline behavior; pipelines look up instead of
`switch`. This retires the "ContentNode -> 3 switches" invariant and is the
plug-in surface the `ExtensionManager` lacks below ProseMirror. A `DocxFeature`
groups a package's contributions across every stage.

```ts
interface NodeCapability<T extends ContentNode> { type: T['type']
  parse?(xml: XmlNode, ctx: ParseCtx): T | null
  serialize?(node: T, ctx: SerializeCtx): XmlNode
  measure?(node: T, ctx: MeasureCtx): MeasuredBlock
  paint?(node: T, ctx: PaintCtx, out: RenderBackend): void }
interface MarkCapability<M extends Mark> { type: M['type']
  serialize?(mark: M, ctx: SerializeCtx): XmlWrap
  styleRun?(mark: M, ctx: PaintCtx, item: Extract<DisplayItem,{kind:'glyphRun'}>): void }
interface DocxFeature { name: string
  documentStore?: DocumentStore; extensions?: Extension[]; replaces?: string[]
  nodeCapabilities?: NodeCapability<ContentNode>[]; markCapabilities?: MarkCapability<Mark>[]
  annotationLayers?: AnnotationLayerSpec[]; requiresPorts?: (keyof RuntimePorts)[] }
```

Shared run/paragraph types stop naming features: feature fields move to an opaque
`annotations: ReadonlyMap<FeatureKey, unknown>` bag.

**Public ergonomics — one `extensions` array.** "Feature bundle" is the internal
contract; the *public* concept is a single ordered `extensions` list, so
selecting capabilities is declarative and trivial:

```ts
interface EditorConfig { extensions?: Extension[] }

createEditor({
  extensions: [StarterKit, PdfExport, Collaboration.configure({ provider }),
               TrackedChanges, Comments],
})
```

- An extension is a vertical bundle: it registers its own schema/plugins,
  capabilities, object-model surface, and `documentStore` internally. Consumers
  never wire stages by hand.
- Not importing an extension removes both its API surface and its dependency
  from the bundle (tree-shaking). `StarterKit` bundles the free editing defaults.
- The list is order-independent; the engine resolves dependencies and `replaces`
  (D5). `.configure(options)` returns a configured extension instance.
- Gated extensions (D7) are ordinary private-registry packages: if you can
  install it, you list it and it runs fully. No keys, no runtime checks, no
  gating code in the consuming app.

### D5 — DocumentStore owns the canonical model; ProseMirror is a projection

The document model is always canonical, reached through `DocumentStore`.
ProseMirror and the display list are projections of it; the CRDT is a swappable
backend. There is no representation that is canonical "sometimes": solo and
collaboration differ only in which backend is installed. This is the shape
`y-prosemirror` already uses (the CRDT is canonical, PM is a binding); making the
solo path use the same shape removes a special case rather than adding one.

```ts
interface DocumentStore {
  readonly model: DocumentModel                      // canonical, always current
  apply(op: DocOp, origin?: unknown): void           // the ONLY mutation path
  subscribe(cb: (change: ModelChange, origin: unknown) => void): () => void
  encode(): Uint8Array                               // persistence / propagation
  merge(update: Uint8Array, origin?: unknown): void  // remote delta in
}

// ProseMirror binds to the store; it is never canonical.
interface EditorBinding {
  bind(store: DocumentStore, view: EditorView): () => void
  // init:  store.model -> EditorState
  // local: PM transaction -> DocOp[] -> store.apply
  // store change (remote / undo / agent) -> reconcile EditorState
}
```

- **Solo:** a plain in-memory op-log backs the store.
- **Collab:** the `CrdtBackend` from `remote-document-sync` *is* a `DocumentStore`
  implementation (`apply` -> `Y.Doc` transaction, `merge` -> remote delta,
  `subscribe` -> local + remote). Same path, different backend; a feature supplies
  it and `replaces: ['history']` because undo is the store's, not PM's.

ProseMirror stays the editing engine: it processes keystrokes and produces
transactions, which `EditorBinding` turns into `DocOp`s. A `DocOp` is the
serializable, anchor-addressed edit from `core-api-contract`, so one currency
serves edit, undo, sync delta, and persistence. Layout reads `store.model`, never
the `EditorView`. A server agent mutates the same store with no view at all.

### D6 — Feature/format/runtime are three orthogonal axes

`collaboration` (feature), `pdf`/`markdown` (format), `server` (deployment) are
kept separate. `pdf`/`markdown` are peers of `server`, not children, so PDF runs
client-side too; `server` *composes* headless rendering, it does not own it.
`collaboration` is a peer feature package, removable from core. ("Headless" is
kept as an adjective — headless render, headless pipeline — never a package
name; the backend package is `server`.)

### D7 — Gating by distribution, not by runtime licensing

Gating is entirely a **distribution** concern; core carries no entitlement or
commercial logic at all. Free extensions are published to the public registry;
gated extensions (e.g. collaboration, PDF) are published to a **private
registry**. Access to install *is* the entitlement: if a consumer can
`npm install @docx-editor.dev/collaboration`, they add it to the `extensions`
array (D4) and it runs fully. There is no license key, no runtime check, and no
degraded mode.

This keeps the model dead simple:

- **Core:** knows only the `extensions` array. No `LicenseProvider`, no
  activation, no policy.
- **Free tier:** `core`, `react`, `vue`, `StarterKit` — public registry, always
  available.
- **Gated tier:** `collaboration`, `pdf` — private registry, installed with a
  customer's registry auth token.
- **Object-model exposure follows what is installed:** an installed extension
  extends the proxy graph (`context.document.comments`,
  `context.document.exportPdf()`); a capability whose package is not installed is
  simply absent, and referencing it is a normal missing-import/type error at
  build time — not a runtime licensing branch.

**Note on server-capable formats.** PDF (run server-side via the `server`
package) can additionally be offered as a hosted service where the
implementation is never shipped to the client; that is a deployment choice on top
of the same package, and still requires no runtime gating in core.

**Alternative considered:** a runtime license-key seam in core (carry an
entitlement set, degrade unentitled features). Rejected — it adds policy and
activation machinery to a core we want kept neutral, and client-side code cannot
be technically restricted once shipped anyway. Private-registry distribution is
both simpler and a stronger install-time gate.

## Risks / Trade-offs

- **Large refactor behind a small-looking proposal** → land contracts as
  type-only additions first, migrate call sites incrementally, keep the build
  green at every step; package extraction is last.
- **Object-model API over an internally-mutating engine can desync** (proxies
  stale after external edits) → define `sync` as the only materialization point
  and document that proxies are valid only within their `run` scope unless
  tracked.
- **Deterministic metrics still will not match the source word processor
  exactly** (justification and compatibility quirks) → scope the goal to
  determinism and near-reference line breaking, not byte-identical line breaks;
  call this out in the metrics spec.
- **Fallback-font licensing** for the headless adapter → restrict to
  metric-compatible fonts that are redistributable; treat as an open question.
- **Versioning-group friction** → decide per package whether it leaves the fixed
  changeset group before extraction, not after.

## Migration Plan

Interface-first, no big-bang, dependency-ordered:

1. Ports (metrics first) — smallest, unblocks isomorphic/server output.
2. Display-list IR — pure addition; nothing depends on its implementation yet.
3. Capability registry + metadata bag — makes core feature-blind.
4. DocumentStore — the canonical-model + backend seam.
5. Object-model API — thin layer over the above; becomes the documented surface.
6. Package extraction — mechanical, only after core compiles with a feature off.

Rollback: each step is additive and independently revertible; the object-model
API can ship behind the existing exports before they are demoted.

## Open Questions

- Which packages leave the fixed changeset version group, and which stay
  lockstep with core.
- How strongly to type per-feature metadata keys (branded keys with a value-type
  registry vs opaque `unknown`).
- The selective-save fast path calls feature serializers inline; it needs the
  same registry treatment as the full serializer.
- Which redistributable metric-compatible fallback fonts to bundle for headless.
- Whether the object-model API should aim for source-compatibility with the
  established add-in object model, or only borrow its shape.
- Gating model is decided: private-registry distribution, no runtime licensing
  (D7). Open sub-question: whether PDF is additionally offered as a hosted
  service, a deployment choice on top of the same package.
