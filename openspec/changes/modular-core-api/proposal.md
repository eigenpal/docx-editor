## Why

We are proposing a new, purpose-built document engine whose primary public
surface is a **batched proxy object-model API** — an application-scoped
`run(context => { ... })` with lazy proxy objects, explicit `load()` + `sync()`
round-trips, and queued mutations flushed on `sync`. This is deliberately
**source-compatible with the widely-deployed document add-in JavaScript object
model** (the client-side `run`/`context.sync`/proxy-load API that document
add-ins are written against), so applications already built for that ecosystem
run against our editor unchanged. (Product name intentionally omitted from repo
content per project convention; see design.md open questions.)

That add-in object model is client-side only. Because our engine is
environment-agnostic (see the ports decision in design.md), we expose the **same
API as a superset**: source-compatible on the client, and additionally runnable
**headless on a server or worker** against a document with no UI — which the
original client API cannot do. One API, three runtimes (browser, worker, server).

## What Changes

- **New public surface — the object-model API.** Core exposes
  `run`/`RequestContext`, a proxy object graph (document, body, paragraphs,
  ranges, tables, sections, comments), and `load`/`sync` semantics as the stable
  programmatic contract for reading and mutating documents. This is the API
  applications integrate against.
- **Compatibility target.** The object model mirrors the shape of the
  established document add-in JS API (a defined requirement-set subset, not the
  full surface) so existing add-in code is portable to our editor.
- **Isomorphic by construction.** Define **runtime ports** (metrics, fonts,
  images) so core declares capabilities and the runtime supplies adapters
  (browser = canvas measurement; headless = font-shaping). The API runs
  unchanged in browser, worker, or server.
- **One positioned IR for all output.** Define a **display-list IR** and a
  `RenderBackend` interface so interactive DOM, PDF, Markdown, print, and
  hit-testing are pure consumers of one positioned model.
- **Open plug-in surface below ProseMirror.** Define a **capability registry**
  so content and mark types register their parse/serialize/measure/paint
  behavior, and a **feature-bundle** contract so an opt-in package contributes
  across every stage. Core must compile and run with any feature absent.
- **Canonical-model seam.** Define a **`DocumentStore`** interface: `store.model`
  is the always-current canonical model, `apply(op)` is the only mutation path,
  `subscribe` reports change, and `encode`/`merge` back persistence and
  propagation. A default single-user op-log backend ships; a collaborative CRDT
  backend can be introduced later without core importing it. ProseMirror binds to
  the store as a projection and is never canonical.
- **Gating by distribution.** Gated extensions (collaboration, PDF) ship as
  private-registry packages; installing one is the entitlement. Core carries no
  licensing or runtime gating. The free object model stays complete for editing
  and DOCX I/O, and gated surfaces appear only when their package is installed.
- **Package topology.** These contracts enable `core` (engine + object-model
  API), `collaboration` (opt-in comments + tracked changes), `pdf` and
  `markdown` (output formats over the display list), and `server` (the backend
  package: Node-wired engine, server-side export, and — via the sync change —
  document hosting). This proposal defines the **interfaces only**;
  implementation and package extraction are follow-up work.

## Capabilities

### New Capabilities

- `core-object-model-api`: the batched proxy request-context API — `run`,
  `RequestContext`, the proxy object graph, `load`/`sync` semantics, queued
  mutation flush ordering, and the add-in-compatible surface subset.
- `runtime-ports`: the metrics/font/image provider interfaces and the adapter
  contract that lets the same API run in browser, worker, or server.
- `display-list-ir`: the positioned intermediate representation and the
  `RenderBackend` interface every output target consumes.
- `capability-registry`: registration of per-type parse/serialize/measure/paint
  behavior, plus the feature-bundle contract grouping a feature's contributions
  across all stages.
- `document-store`: the canonical-model interface (`store.model`, `apply(op)`,
  `subscribe`, `encode`/`merge`) with a default single-user op-log backend and a
  swappable CRDT backend, plus the `EditorBinding` that projects ProseMirror.

### Modified Capabilities

<!-- Greenfield engine: no existing spec-level requirements change in this
     change. New capabilities only. -->

## Impact

- **Public API**: the object-model API is the documented, supported surface.
  API Extractor snapshots and the React/Vue parity contract gain the new types.
- **Compatibility**: applications written against the established add-in object
  model can target our editor client-side; the same code can additionally run
  headless, which the original cannot.
- **Packages**: establishes `core` + `collaboration` + `pdf` + `markdown` +
  `server`, with heavy dependencies (font shaping, PDF emit) confined to `pdf`
  and `server` and kept out of the browser editor bundle.
- **Runtime**: ports remove the single browser tether; layout becomes
  deterministic and isomorphic.
- **No runtime behavior change in this change**: contracts are interface-only;
  the build stays green.
