## Context

v1 let consumers hand `y-prosemirror` plugins to a hidden ProseMirror editor. That proved Yjs ecosystem compatibility but made the PM projection authoritative and left baseline initialization, durable state, comments, IDs, and several races to the consumer. v2 removed that API and now requires every authored write to pass through `TreePackageStore.transact` / `TreeDocumentStore.transact`; ProseMirror, layout, and painted DOM are projections only.

The current tree operations are JSON-safe and atomic but not a concurrent wire protocol. Engine node IDs, comment IDs, and revision IDs are minted from local sequential state; text operations carry absolute UTF-16 offsets; snapshot undo records every origin except projection. The smallest safe proof therefore limits collaboration to insertion and deletion in already identified body paragraphs and changes the minimum origin/history seams before any network integration.

The product is a library. It will not operate signaling, TURN, persistence, or room servers. WebRTC still requires signaling and may require a TURN relay; "peer to peer" here means document updates normally flow directly between peers and no docx-editor-operated document backend exists.

AI agents are first-class participants rather than a later browser adaptation. Each browser tab, worker, or headless process owns its own canonical `TreePackageStore` replica and its own synchronized `Y.Doc`; processes never share the browser's in-memory store or one JavaScript `Y.Doc` object. A headless client needs the same room protocol and converged state but no layout, paint, ProseMirror, React, or WebRTC dependency. Its provider is supplied by the application: an in-process test document, WebSocket provider, hosted Yjs provider, or any other compatible transport.

## Goals / Non-Goals

**Goals:**

- Prove that two or three replicas converge for concurrent insertion/deletion in existing body paragraphs while save and layout remain tree-authoritative.
- Define one provider-neutral Yjs binding usable by browsers, workers, and server-side agents.
- Provide a no-docx-editor-backend WebRTC creator/joiner convenience path and runnable demo.
- Transfer and validate one bounded immutable DOCX baseline exactly once per room.
- Publish presence and remote selections through non-canonical awareness.
- Give each actor selective collaborative undo that cannot erase remote work.
- Let `@docx-editor.dev/editor-api` borrow the live canonical collaboration session so an AI agent can read and submit supported edits without rendering.
- Let two developers start the same repository demo independently on localhost, exchange one room link, and prove synchronization across their machines.
- End the change when the smallest proof and its adversarial gates pass.

**Non-Goals:**

- Paragraph creation, split, join, reorder, paste that changes block structure, or collaborative ID allocation.
- Formatting, comments, tracked changes, tables, sections, headers/footers, notes, drawings, media, fields, or content controls.
- A production availability, privacy, authentication, authorization, audit, notification, or durable-hosting claim.
- A docx-editor-operated signaling, TURN, WebSocket, persistence, or collaboration service.
- A production server package; consumers may already use Hocuspocus, Liveblocks Yjs, `y-websocket`, or another provider through the same low-level API.
- Local-first guarantees beyond the reconnect scenarios proved by the demo; optional IndexedDB convenience is not required for completion.
- A Loro implementation or a frozen future full-document CRDT schema. Loro may be evaluated only after this proof if measured Yjs limits justify it.
- Restoring v1's `externalPlugins` or making ProseMirror a source of authored state.

After this proof, full collaboration remains the product goal. The follow-on design must cover every canonical edit across body, tables, sections, headers, footers, footnotes, endnotes, images, drawings, comments, revisions, fields, and future typed or generic OOXML. It must derive from the canonical write model or another compact compositional representation rather than duplicate every editor command in a separate manually maintained protocol. This change records that constraint but does not choose the full model.

## Decisions

### D1: One provider-neutral collaboration session, optional provider conveniences

`@docx-editor.dev/collaboration-yjs` will own the Yjs-to-canonical bridge but not networking. Its low-level creation API accepts a consumer-owned `Y.Doc`, awareness instance, identity, and explicit bootstrap role. The caller owns and destroys supplied Yjs/provider resources.

A separate `@docx-editor.dev/collaboration-yjs/webrtc` entry point may create and own `Y.Doc`, `WebrtcProvider`, and awareness for convenience. Its static import graph alone may reach `y-webrtc`; the package's default entry and all default core/editor imports must not.

Proposed low-level browser API:

```ts
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { createYjsCollaboration } from '@docx-editor.dev/collaboration-yjs';

const ydoc = new Y.Doc();
const provider = new WebrtcProvider(roomId, ydoc, {
  signaling: ['wss://signaling.yjs.dev'],
  peerOpts: {
    config: {
      iceServers: [{ urls: 'stun:stun.example.com:3478' }],
    },
  },
});

const room = await createYjsCollaboration({
  ydoc,
  awareness: provider.awareness,
  identity: { actorId: user.id, name: user.name, color: user.color },
  bootstrap: isCreator ? { kind: 'create', document: docxBytes } : { kind: 'join' },
});

const editor = createDocxEditor({
  document: room.document,
  collaboration: room.session,
});
editor.attach(container);

// Low-level ownership stays with the consumer.
editor.destroy();
room.destroy();
provider.destroy();
ydoc.destroy();
```

Proposed React use is thin pass-through after asynchronous room readiness:

```tsx
const room = useYjsWebrtcCollaboration({
  roomId,
  identity: user,
  bootstrap: isCreator ? { kind: 'create', document: docxBytes } : { kind: 'join' },
  signaling,
  iceServers,
});

if (room.status !== 'ready') {
  return <RoomStatus status={room.status} error={room.error} />;
}

return <DocxEditor document={room.document} collaboration={room.session} />;
```

The exact React hook name is provisional. The stable architectural contract is the framework-neutral session, not provider construction.

Alternative considered: ship separate P2P and server collaboration engines. Rejected because Yjs providers already separate merge state from transport. One binding can use WebRTC today and a WebSocket/hosted provider later without changing editor semantics.

### D2: Add a Yjs-free collaboration attachment contract to core

Core contracts will define an `EditorCollaborationSession`-like capability containing lifecycle, supported-operation gating, local intent submission, remote publication, selection awareness, and undo/redo delegation. The editor and automation host may attach this contract, but it names no Yjs type and performs no networking.

The new guarded collaboration lane may import store and automation contracts. The default editor may statically import only the small Yjs-free attachment code; Yjs implementation code lives in the optional package and is passed at construction.

Core already freezes `mutationHuman`, `mutationAgent`, `mutationRemote`, `mutationUndo`, `mutationRedo`, `projection`, and `awareness` origin IDs; this change reuses rather than duplicates them. `applyTreeOps`, package transactions, and automation apply requests must plumb the selected origin plus stable `actorId` and `operationId`. Collaboration-derived canonical commits skip legacy snapshot history because their undo authority is `Y.UndoManager`; ordinary non-collaborative commits retain current snapshot undo behavior. Published model changes keep enough attribution for feedback suppression and duplicate correlation without exposing provider objects.

`EditorModule` is not used: it is deliberately closed to named capabilities and is not a generic plugin bus.

Alternative considered: expose `Y.Doc` directly on `DocxEditor`. Rejected because it would make a third-party storage type public editor architecture, force adapters to know Yjs, and prevent future backends from implementing the same engine contract.

### D3: Versioned minimal Yjs schema keyed by Word paragraph identity

The proof schema is versioned and private to the optional package:

```text
root: Y.Map
  meta: Y.Map
    protocolVersion
    schemaVersion
    documentId
    baselineSha256
    baselineByteLength
    initializedBy
  baseline: Uint8Array
  bodyParagraphs: Y.Map<UppercaseW14ParaId, Y.Text>
```

The creator performs one transaction that records immutable metadata, baseline bytes, and initial body paragraph text. A joiner never seeds. `w14:paraId`, not session-local structural IDs, keys shared paragraphs. Every replica maintains a local map from `w14:paraId` to the current canonical paragraph node.

Only existing body paragraphs are admitted. The session refuses operations that add, remove, split, join, reorder, or target an unidentified/non-body paragraph. This avoids pretending the first schema answers structural identity. A later change may replace the per-paragraph representation with a long-lived story sequence and boundary records; this proof does not pre-decide it.

Alternative considered: mirror OOXML as `Y.XmlFragment`. Rejected because Yjs XML does not enforce package invariants, has weak move semantics, and would create a second full document authority.

Alternative considered: put only raw `TreeDocOp` envelopes in a shared array. Rejected because absolute offsets and locally minted IDs do not converge under concurrent application.

### D4: Baseline bytes travel once in shared state for the bounded proof

The creator places the original validated DOCX bytes in the room so a joiner can preserve unknown OOXML without a separate file service. Metadata and bytes are immutable after initialization. The existing bounded package reader validates received bytes before a canonical session becomes visible.

This is intentionally a proof mechanism, not a large-document distribution claim. The collaboration layer adds a strict baseline byte cap no larger than the package reader's accepted total and rejects oversized Yjs updates before allocation where possible. Later hosted integrations may store a content-addressed baseline outside Yjs and replicate only its digest/reference.

Alternative considered: require every peer to provide the same local file. Rejected because it makes share-link joining incomplete and cannot reliably prevent accidental mismatch.

### D5: Canonical local commits mirror synchronously into Yjs

For a supported local insertion/deletion:

1. The editor or automation host plans a normal `TreeDocOp` against the committed canonical revision.
2. The collaboration session validates that the operation targets an existing shared body paragraph.
3. The canonical store validates and publishes one collaboration-attributed transaction without legacy snapshot history.
4. The attached collaboration port synchronously derives the changed paragraph text and mirrors it into one actor-tagged Yjs transaction before control returns to the host.
5. Projection and layout continue to consume only the canonical publication.

For a remote update:

1. The Yjs provider merges the update.
2. The collaboration session observes changed paragraph text and derives the minimal canonical insertion/deletion batch.
3. It stages and validates that batch.
4. It publishes once with `ORIGIN_IDS.mutationRemote`.

Local-origin tagging and a reentrancy guard prevent feedback. The proof uses canonical-first local mirroring because the admitted local slice has already passed canonical validation, and `Y.Text` insertion/deletion over the mapped paragraph cannot reject that validated text. A mirror failure moves the session to an explicit error state; it never creates a second canonical authority. A future full-document model must revisit this boundary because structural replication can fail after canonical acceptance and may require staged shared intent.

Alternative considered: make Yjs the first local publication. Rejected for the proof because it would require a second staged transaction protocol before the smallest communication test. It remains an option for the post-proof full-document design.

### D6: Collaborative sessions replace snapshot undo for the supported slice

The Yjs adapter creates one `Y.UndoManager` scoped to shared paragraph text and configured with actor/session-specific tracked origins. Remote, awareness, projection, bootstrap, migration, and repair origins are excluded. Undo and redo mutations flow through the same observer-to-canonical path.

The existing package snapshot undo cannot handle collaborative text because pointer-swapping an earlier package can remove accepted remote edits. In collaborative mode, supported text undo/redo delegates to the collaboration session. Unsupported document operations are refused, so there is no mixed local snapshot history in the proof.

### D7: Awareness carries semantic relative selections only

Awareness state uses a bounded, versioned record:

```ts
interface CollaborationAwarenessState {
  readonly actorId: string;
  readonly name: string;
  readonly color?: string;
  readonly selection?: {
    readonly paragraphId: string; // w14:paraId
    readonly anchor: Uint8Array; // encoded Y.RelativePosition
    readonly head: Uint8Array;
  };
}
```

On every relevant Yjs change, peers resolve relative endpoints to current UTF-16 offsets and ask semantic layout for rectangles/carets. The output layer paints separate `contenteditable=false` furniture; it does not reuse or suppress the local caret. Missing/deleted/unplaced positions fail soft by hiding that remote selection.

Awareness never enters canonical transactions, history, snapshots, baseline, or DOCX output.

### D8: Headless agents borrow the same live canonical session

`@docx-editor.dev/editor-api` gains a Yjs-neutral factory that borrows a ready collaboration session, analogous to `createBrowser` borrowing an open editor:

```ts
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { createYjsCollaboration } from '@docx-editor.dev/collaboration-yjs';
import { DocxEditor } from '@docx-editor.dev/editor-api';

const ydoc = new Y.Doc();
const provider = new HocuspocusProvider({
  url: process.env.COLLAB_URL!,
  name: documentId,
  document: ydoc,
  token: process.env.COLLAB_TOKEN!,
});

const room = await createYjsCollaboration({
  ydoc,
  awareness: provider.awareness,
  identity: {
    actorId: `agent:${agentId}`,
    name: 'Contract review agent',
  },
  bootstrap: { kind: 'join' },
});

const runtime = DocxEditor.createCollaborative(room.session, {
  author: 'Contract review agent',
});

await runtime.run(async (context) => {
  const paragraphs = context.document.body.paragraphs;
  paragraphs.load();
  await context.sync();

  // The proof permits insertion/deletion in existing paragraphs only.
  paragraphs.items[0]?.insertText('[AI reviewed] ', 'Start');
  await context.sync();
});

runtime.dispose(); // Does not close the borrowed room.
room.destroy();
provider.destroy();
ydoc.destroy();
```

`createCollaborative` is a proposed name. Within that headless process it returns a runtime over the room replica's existing automation host rather than parsing a second local snapshot. A browser in another process has a separate store and `Y.Doc`; provider updates make those replicas converge. Reads see only committed canonical revisions. `context.sync()` remains the atomic write boundary, uses the existing `expectedRevision` stale-write guard, and unsupported planned operations fail before Yjs mutation. Agent identity selects the existing agent mutation origin and supplies future attribution; it is not taken from prompt text.

A browser-side agent can instead use existing `DocxEditor.createBrowser(editor)` because it already borrows the user's canonical editor. Server-side agents need `createCollaborative` because no editor is mounted.

Alternative considered: let an agent mutate `Y.Text` directly. Rejected because it bypasses operation validation, resource accounting, protection, unsupported-scope gates, and semantic transaction grouping.

### D9: Yjs 13.x is the only CRDT implementation in this change

The optional package targets the current stable Yjs 13 line. Yjs 14 prereleases and Loro are excluded from implementation. Tests target public Yjs update, relative-position, awareness, and undo APIs and pin compatibility through package-manager ranges plus conformance fixtures.

The proof succeeds or fails on observable behavior, not a Yjs state vector. Convergence is established by canonical authored fingerprints and save/reopen semantic digests.

### D10: Proof gates precede public support claims

The demo is complete only when two/three logical replicas pass:

- Same-position concurrent insertion.
- Overlapping insertion and deletion.
- Different update orders and duplicate delivery.
- Temporary disconnect and reconnect.
- Actor-local undo and redo.
- Awareness isolation.
- Single baseline initialization and mismatch/size refusal.
- Headless agent edit reaching browser replicas and vice versa.
- Two independently started localhost demos on separate development machines joining one room through reachable signaling.
- Canonical fingerprint and save/reopen semantic digest equality.
- Default bundle and DOM-free headless dependency guards.

Until all gates pass, public docs describe collaboration as unsupported. Afterward they may describe only the exact experimental slice, not full realtime collaboration.

## Risks / Trade-offs

- **[Yjs state can converge while canonical validation fails]** → Admit only existing-paragraph text, keep shared types private, stage canonical derivation atomically, quarantine malformed rooms, and make no Byzantine or arbitrary-client compatibility claim.
- **[Baseline bytes make initial Yjs updates large]** → Enforce strict byte/resource caps and treat in-Yjs transfer as proof-only; defer content-addressed external baseline storage.
- **[A provider allocates an update before observers can validate it]** → Cap baseline and resulting shared text, quarantine invalid state before canonical publication, and record that production transport needs a pre-apply byte limit.
- **[Two creator pages initialize one room independently]** → Initialize before connecting, remove the creator role from the live URL, share a join-only link, and quarantine different baselines after merge.
- **[Public signaling or room URLs are mistaken for security]** → Generate high-entropy room IDs, document signaling/TURN honestly, never log secrets, and make authenticated providers a consumer concern.
- **[WebRTC fails behind restrictive NAT/firewalls]** → Expose signaling and ICE/TURN configuration and an explicit disconnected/error state; do not claim universal connectivity.
- **[Current store history erases remote work]** → Route collaborative text undo exclusively through actor-scoped `Y.UndoManager` and exclude remote origins from local snapshot history.
- **[Paragraph identity is absent or duplicated]** → Normalize and validate body `w14:paraId` before bootstrap; refuse ambiguous shared addressing.
- **[Per-paragraph Y.Text constrains future split/join semantics]** → Version the experimental schema and explicitly avoid promising migration or structural compatibility before the proof informs the next design.
- **[A headless agent produces untrusted or oversized content]** → Keep automation/tree validation and resource limits before shared mutation; never expose direct mutable Yjs types as the authoring API.
- **[Adapters acquire a second editing state]** → Keep the session framework-neutral and pass it through React; all authored reads/writes remain engine-owned.
- **[Optional dependencies leak into default bundles]** → Add import-graph, package-dependency, and DOM-free entry-point tests before implementation code.

## Migration Plan

1. Correct stale docs/example inventory before or with the first implementation commit; do not leave a full-support claim during the experiment.
2. Add Yjs-free collaboration contracts and transaction-origin/history seams with collaboration absent by default.
3. Add the optional Yjs package and private versioned schema.
4. Add the WebRTC convenience entry and demo behind explicit experimental naming.
5. Add the editor-api borrowed-session factory and headless proof.
6. Publish only after all bounded proof gates pass and API extraction/parity/package checks are updated.

Rollback is additive: remove the optional package, convenience demo, and collaboration option; the default tree editor and existing documents retain their previous behavior. Baseline DOCX bytes remain valid independently of experimental Yjs room state.

## Open Questions

Questions deliberately left for evaluation after the smallest demo:

1. Whether paragraph split/join should use one long-lived story `Y.Text` with boundary embeds, separate paragraph records with actor-scoped IDs, or a different model.
2. Whether measured Yjs document growth, tree-move limitations, or history requirements justify a Loro spike.
3. Whether shared baseline bytes should move to consumer-supplied content-addressed storage.
4. Which formatting, comments, tracked changes, structural operations, offline guarantees, and review workflows users value next.
5. Whether consumers need a docx-specific server helper for authoritative validation/export, beyond using existing Yjs providers. No such helper is planned by this change.
6. Which compact compositional replication model can cover every current and future canonical `TreeDocOp` without maintaining a second exhaustive command protocol.
