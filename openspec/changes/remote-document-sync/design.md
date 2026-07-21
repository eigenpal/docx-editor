## Context

This is the realtime propagation layer for an addressable document. It sits on
the object-model API, the `extensions` selection model, the `DocumentStore`
seam, and the collaboration package (all from `modular-core-api`), and it reuses
the headless engine (from `chromium-free-rendering-engine`) so a server process
can edit and render a document without a browser.

A document is identified by a **resolvable URL**. Browsers and server processes
attach to the same authoritative CRDT document; every mutation is a commutative
binary delta that fans out to all participants. The design goal is to be
**friendly for propagation**: the same delta path serves a keystroke, a
server-side job, and an offline replay.

Security is explicitly out of scope (see Non-Goals).

## Goals / Non-Goals

**Goals:**

- Make a document addressable and attachable by URL from browser and server.
- Keep the CRDT library an implementation detail behind one seam; default to
  Yjs, allow Automerge without changes above the seam.
- Let a server process participate as a first-class editor via the headless
  object model, with its changes streaming live to clients.
- Keep the wire transport swappable (WebSocket, SSE+POST, managed) with the
  editor unaware of the choice.

**Non-Goals:**

- **Security.** Authentication, authorization, transport encryption, tenancy
  isolation, rate limiting, and input trust are the integrating developer's
  responsibility. The contracts expose hooks (e.g. an `auth` callback) but define
  no security policy.
- Persistence backend choice, presence UI, and conflict-resolution policy beyond
  what the CRDT provides.
- Defining the CRDT wire format; deltas are opaque `Uint8Array`.

## Decisions

### D1 — CRDT behind a backend seam; Yjs default, Automerge swappable

All document change is expressed as opaque binary deltas plus edit-surviving
anchors, so the CRDT library never leaks above this interface.

```ts
interface CrdtBackend {
  encodeState(): Uint8Array                                  // full snapshot
  applyUpdate(update: Uint8Array, origin?: unknown): void    // remote → local
  onChange(cb: (update: Uint8Array, origin: unknown) => void): () => void  // local → wire
  createAnchor(pos: number): AnchorRef                        // survives concurrent edits
  resolveAnchor(a: AnchorRef): number | null
  bindProseMirror(view: EditorView): () => void              // returns unbind
  awareness?: AwarenessChannel
}
```

- **Yjs backend (default):** `Y.Doc` + `y-prosemirror` (`ySync`/`yUndo`/`yCursor`)
  + `Y.RelativePosition` anchors + the awareness protocol.
- **Automerge backend (swappable):** `automerge-repo` `DocHandle` +
  `@automerge/prosemirror` + cursors.

The collaboration `DocumentStore` (from `modular-core-api` D5) *is* this
`CrdtBackend`: `encodeState`/`applyUpdate`/`onChange` back `store.encode`/`merge`/
`subscribe`, and a `DocOp` applied via `store.apply` becomes a `Y.Doc`
transaction. The comment `AnnotationStore` sits on it too, so switching CRDT
libraries is one implementation, not a rewrite.

**Rationale / alternative considered:** binding directly to Yjs would be simpler
short-term but couples the editor to one library's document model and history
semantics. Yjs is chosen as default because `y-prosemirror` is the mature
ProseMirror binding; Automerge is kept reachable for its native document-URL
addressing and rich history, which are attractive on a data-first product axis.

### D2 — Two propagation invariants

Propagation is a property of the data model, not of the transport:

1. **All syncable state lives in the CRDT** — content, comments, tracked-change
   marks. State kept in side-channel PM plugin state or app memory does not
   replicate.
2. **All cross-references use edit-surviving anchors, never raw offsets** —
   comment ranges, cursors, tracked-change spans. A raw position is invalid the
   moment a concurrent upstream edit lands; an anchor survives the merge.

With both held, a server `edit()` delta, a peer keystroke, and an offline replay
travel the identical apply path.

### D3 — `RemoteSync` client extension over a resolvable URL

Attaching is one entry in the `extensions` array:

```ts
RemoteSync.configure({
  url: string | (() => Promise<string>),   // resolvable (static or dynamic)
  auth?: () => Promise<string>,             // token hook; policy is the developer's
  transport?: SyncTransport,                // default provided; overridable
  offline?: boolean,                        // local persistence + replay on reconnect
})
```

Lifecycle: resolve URL → connect (via transport) → initial sync (exchange state,
converge) → stream updates both ways → on disconnect, buffer local changes and
replay on reconnect (when `offline`).

### D4 — Transport is pluggable and CRDT-opaque

```ts
interface SyncTransport {
  open(url: string, h: {
    onRemoteUpdate(update: Uint8Array): void
    onStatus(s: ConnectionStatus): void
    onAwareness?(peers: AwarenessState[]): void
  }): SyncChannel
}
interface SyncChannel {
  sendUpdate(update: Uint8Array): void
  sendAwareness?(s: AwarenessState): void
  close(): void
}
type ConnectionStatus = 'connecting' | 'connected' | 'syncing' | 'offline' | 'closed'
```

| Transport | Direction | Best when | Deployment |
| --------- | --------- | --------- | ---------- |
| WebSocket | symmetric | heavy multi-user live editing | needs long-lived connections |
| SSE + POST | server→client stream, client→server posts | server-authoritative pushes; few writers | serverless/edge-friendly; streaming HTTP, auto-reconnect, no held socket |
| Managed realtime | symmetric | offload the hub | vendor-hosted |

**Decision:** ship a **WebSocket** transport and an **SSE+POST** transport; make
SSE+POST the recommended default for serverless/edge deployments, where a
long-lived socket is the awkward part and a streaming response is not. The seam
means the app chooses without the editor caring.

### D5 — Server hub reuses the headless engine

```ts
interface DocumentHub { document(id: string): ServerDocument }

interface ServerDocument {
  snapshot(): Uint8Array
  applyUpdate(update: Uint8Array, origin?: unknown): void
  onUpdate(cb: (update: Uint8Array, origin: unknown) => void): () => void
  edit(fn: (ctx: RequestContext) => Promise<void>): Promise<void>   // headless; delta broadcasts
  export(format: 'docx' | 'pdf'): Promise<Uint8Array>               // headless render
  persist(): Promise<void>
}
```

`edit()` runs the object-model API on the authoritative doc via the same
`CrdtBackend`; its delta is broadcast to all clients through the transport. This
is the "server-originated updates stream to clients" path — an agent, a workflow,
or a template merge, all live, all browserless.

## Risks / Trade-offs

- **Automerge PM binding is less proven than Yjs** → default to Yjs; keep the
  Automerge backend behind the seam and gate it on its own parity harness before
  offering it.
- **Large-doc delta volume / rebroadcast storms** → the hub coalesces and
  batches deltas; clients apply by origin to avoid echo.
- **Offline replay divergence** → rely on CRDT convergence; treat `offline` as
  buffered deltas replayed on reconnect, not a separate merge policy.
- **Backend swap is not runtime-hot** → the backend is chosen at document
  creation; migrating an existing doc between CRDT libraries is a separate export
  and re-seed, not a live switch.

## Migration Plan

New packages; nothing to migrate. Land in order: `CrdtBackend` seam + Yjs backend
→ `SyncTransport` + `RemoteSync` (SSE+POST first, then WebSocket) → `DocumentHub`
/ `ServerDocument` → Automerge backend behind the seam. Each step is additive and
independently revertible.

## Open Questions

- Persistence contract for the hub (snapshot cadence, delta log vs snapshot).
- Whether awareness/presence ships in this change or with the deferred presence
  concern.
- Whether the hub exposes a subscribe-only (read-stream) mode as a first-class
  role for viewers.
- Delta coalescing/batching parameters and their defaults per transport.
