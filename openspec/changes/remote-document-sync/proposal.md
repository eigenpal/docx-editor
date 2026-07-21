## Why

We want documents to be **addressable** — each identified by a resolvable URL —
so that browsers and server processes attach to the *same* authoritative
document and every change propagates to all of them. Once a document has an
address, the headless engine turns the server into a first-class editor: a
server process opens the doc by URL, mutates it through the object-model API, and
the resulting change streams live to every connected browser, with no browser on
the server.

This is the realtime propagation layer. Its defining goal is to be **friendly for
propagation**: every change is a commutative, mergeable binary delta with an
origin, carried over a swappable transport, and applied identically whether it
came from a keystroke, a server job, or an offline replay.

```
                 document @ wss://host/d/abc123  (authoritative CRDT doc)
   browser A  ◄────────────┐
   browser B  ◄────────────┤  sync hub: relay + persistence
   server job ◄────────────┘  (server participates via the headless object model)
        ▲ all attach to the same addressable doc; deltas fan out to everyone
```

## What Changes

This builds on the `modular-core-api` change (object-model API, `extensions`
model, `DocumentStore`, collaboration) and the `chromium-free-rendering-engine`
change (headless engine for server-side edit and export). It adds the client
package `@docx-editor.dev/sync` (transport) and adds the **sync hub** to the
`@docx-editor.dev/server` backend package, both depending on `collaboration`.

- **CRDT-agnostic backend seam.** A `CrdtBackend` interface expresses all
  document change as opaque binary deltas plus edit-surviving anchors, so the
  CRDT library is an implementation detail. **Default: a Yjs backend** (`Y.Doc` +
  `y-prosemirror` + relative positions + awareness). **Swappable: an Automerge
  backend** (`automerge-repo` `DocHandle` + `@automerge/prosemirror` + cursors).
  Nothing above the seam knows which is in use.
- **Two propagation invariants.** (1) All syncable state — content, comments,
  tracked-change marks — lives in the CRDT; anything in side-channel state does
  not propagate. (2) All cross-references — comment ranges, cursors,
  tracked-change spans — use edit-surviving anchors, never raw offsets. These
  make server, peer, and offline changes all propagate through one path.
- **`RemoteSync` client extension.** An entry in the `extensions` array pointed
  at a resolvable URL: resolve → connect → initial sync → stream both ways, with
  optional offline persistence and replay on reconnect.
- **Pluggable transport.** A `SyncTransport`/`SyncChannel` contract carrying
  CRDT-opaque deltas, with WebSocket, SSE+POST, and managed-service
  implementations. The editor is transport-unaware.
- **Server hub.** A `DocumentHub` / `ServerDocument` API: apply and observe
  updates, `edit(ctx => …)` to mutate via the headless object model (delta
  broadcasts to all clients), `export('docx'|'pdf')` server-side, and `persist()`.

## Capabilities

### New Capabilities

- `crdt-backend`: the CRDT-agnostic backend seam (opaque deltas + anchors +
  ProseMirror binding + awareness), the two propagation invariants, the default
  Yjs backend, and the swappable Automerge backend.
- `remote-sync-transport`: the `RemoteSync` client extension (resolvable URL,
  connect, initial sync, bidirectional streaming, offline replay) and the
  `SyncTransport` contract with WebSocket / SSE+POST / managed implementations.
- `document-hub`: the server-side `DocumentHub` / `ServerDocument` API — update
  apply/observe, headless `edit`, server-side `export`, and `persist`.

### Modified Capabilities

<!-- New packages built from scratch. Depends on capabilities defined in the
     modular-core-api and chromium-free-rendering-engine changes; modifies no
     existing specs. -->

## Impact

- **Packages**: adds `sync` (client transport) and adds the sync hub to the
  `server` backend package; both depend on `collaboration` for the shared
  document.
- **Dependencies**: a CRDT library (Yjs by default; Automerge optional) and the
  chosen transport implementation, confined to these packages.
- **Server**: the hub reuses the headless engine so server processes edit and
  render without a browser.
- **Deployment**: the transport seam lets an app choose WebSocket (heavy live
  editing) or SSE+POST (serverless/edge-friendly, server-authoritative pushes)
  without touching the editor.
- **Out of scope**: security. Authentication, authorization, transport security,
  tenancy isolation, and input trust are the integrating developer's
  responsibility; this change defines sync mechanics only.
