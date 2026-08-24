## 1. Establish the experimental boundary

- [x] 1.1 Correct `collab.realtime` and affected docs/examples so current v2 is not described as having full collaboration, and label the new work as an experimental existing-paragraph-text proof.
- [x] 1.2 Add a focused fixture with multiple body paragraphs, stable `w14:paraId` values, unknown OOXML to preserve, and enough text for concurrent insert/delete cases.
- [x] 1.3 Add tests that detect missing or duplicate body paragraph IDs and define deterministic refusal/normalization before collaboration bootstrap.
- [x] 1.4 Add a consumer-facing minor changeset for the additive optional experimental collaboration API.

## 2. Add Yjs-free core collaboration seams

- [x] 2.1 Define public provider-neutral collaboration lifecycle, identity, status, supported-operation, awareness-selection, undo/redo, and teardown contracts without importing Yjs.
- [x] 2.2 Add a guarded core collaboration lane and update the machine-readable lane DAG, package exports, and isolation tests.
- [x] 2.3 Plumb the existing frozen human, agent, remote, undo/redo, projection, and awareness origins through `applyTreeOps`, package transactions, and automation apply requests, and add stable actor/operation identity for attribution and duplicate correlation.
- [x] 2.4 Make every collaboration-derived canonical commit bypass legacy snapshot history, retain snapshot undo for ordinary non-collaborative commits, and add regression tests proving collaborative or remote work cannot be removed by local legacy undo.
- [x] 2.5 Add an editor/automation attachment seam that delegates collaborative operation gating and text undo/redo only when a collaboration session is supplied.
- [x] 2.6 Add default-bundle dependency tests proving core, React, editor-api, layout, output, and store entry points do not reach Yjs or a provider when collaboration is unused.

## 3. Build the provider-neutral Yjs package

- [x] 3.1 Scaffold `@docx-editor.dev/collaboration-yjs` with `@docx-editor.dev/core` and stable Yjs 13 as peers, package-dependency assertions, exports, build metadata, license/API gates, and a default entry that imports no network provider.
- [x] 3.2 Implement the private versioned Yjs root schema for immutable metadata, bounded baseline bytes, and one `Y.Text` per existing body `w14:paraId`.
- [x] 3.3 Implement creator bootstrap as one initialization transaction that validates/parses bytes, captures the original baseline, seeds paragraph text once, and records digest/version/size metadata.
- [x] 3.4 Implement joiner bootstrap that waits for initialization, validates metadata/digest/bounds, opens exactly the received baseline, and refuses competing or mismatched initialization.
- [x] 3.5 Add explicit initializing, ready, disconnected, error, and destroyed state plus deterministic listener/observer cleanup while retaining consumer ownership of supplied Yjs/provider resources.
- [x] 3.6 Add malformed shared-schema, oversized baseline/update, unsupported key, and invalid paragraph identity tests that quarantine the session without partially publishing canonical state.

## 4. Synchronize the smallest authored text slice

- [x] 4.1 Map canonical existing body paragraphs to shared `Y.Text` values by normalized `w14:paraId` and maintain the mapping across canonical revisions without session-local IDs on the wire.
- [x] 4.2 Mirror each accepted local UTF-16 insert/delete canonical transaction synchronously into one actor-tagged Yjs transaction, with explicit error state on mirror failure.
- [x] 4.3 Derive minimal canonical insert/delete batches from local and remote Yjs text events and publish each accepted transaction exactly once through `TreePackageStore.transact`.
- [x] 4.4 Add feedback guards so projection and observer reconciliation cannot generate another authored Yjs update or canonical history entry.
- [x] 4.5 Stage and validate remote derivation atomically so failures leave package, revision, indexes, history, and subscribers on the previous committed state.
- [x] 4.6 Refuse paragraph create/split/join/reorder, formatting, paste with block structure, comments, tracked changes, tables, headers/footers, notes, drawings, and every other out-of-scope operation before local or shared mutation.
- [x] 4.7 Add two/three-replica tests for same-position insertion, overlapping insert/delete, reverse delivery order, delayed delivery, duplicate update delivery, and atomic refusal.

## 5. Add collaborative undo and awareness

- [x] 5.1 Create one actor-scoped `Y.UndoManager` over shared paragraph text with only that actor's accepted human or agent origins tracked.
- [x] 5.2 Route collaborative text undo/redo through the Yjs manager and canonical observer path, with tests proving Alice cannot undo Bob's edit.
- [x] 5.3 Encode bounded awareness identity and collapsed/range selections with paragraph identity and Yjs-relative anchor/head positions.
- [x] 5.4 Resolve remote relative positions after updates and expose semantic selection positions without changing canonical revision, snapshot, history, baseline, or saved DOCX.
- [x] 5.5 Paint non-editable remote caret/range furniture from semantic layout geometry and fail soft for deleted, missing, non-body, or unplaced positions.
- [x] 5.6 Add tests proving awareness movement/disconnect creates no authored transaction and does not alter local caret ownership or document output.

## 6. Attach browsers and React

- [x] 6.1 Accept the provider-neutral collaboration session in `createDocxEditor` and wire readiness, operation gating, collaborative undo, and awareness without widening the adapter into a second state owner.
- [x] 6.2 Add thin React attachment/hook glue for room status and collaboration session lifecycle, preserving StrictMode-safe attach/detach and existing editor parity constraints.
- [x] 6.3 Disable or refuse every unsupported authoring path in the demo with the engine-provided reason rather than allowing divergent local edits.
- [x] 6.4 Add API Extractor snapshots and browser integration tests for attach, detach, remount, selection, undo, and teardown.

## 7. Build the peer-to-peer proof

- [x] 7.1 Add a `@docx-editor.dev/collaboration-yjs/webrtc` entry that creates owned Yjs/awareness/`y-webrtc` resources from room ID, identity, signaling endpoints, and optional ICE configuration.
- [x] 7.2 Implement explicit creator and joiner convenience APIs, cryptographically strong room-link generation, connection/error status, and ownership-correct destroy behavior.
- [x] 7.3 Build a runnable repository example with create/share-link join, initializing/connection state, presence, remote selection, supported typing, undo/redo, disconnect/reconnect, and DOCX save; make the documented start command and room link work between two independently started localhost instances on separate machines.
- [x] 7.4 Document that public signaling is proof-only, room IDs are not authorization, WebRTC may require TURN, no durable shared availability exists, and no docx-editor backend is operated.
- [ ] 7.5 Add isolated-browser end-to-end coverage for creator/joiner bootstrap, supported collaboration, temporary disconnect/reconnect, unsupported controls, and the same URL contract used by two separate localhost machines.

## 8. Add the headless AI-agent path

- [x] 8.1 Add a Yjs-neutral `DocxEditor.createCollaborative`-style editor-api factory that borrows a ready collaboration session's automation host and never constructs DOM, layout, paint, ProseMirror, React, or WebRTC.
- [x] 8.2 Route agent `context.sync()` writes through the same supported-operation gate, existing `expectedRevision` stale-write guard, and tagged Yjs transaction path with stable actor/session/operation identity and typed refusals.
- [x] 8.3 Add a runnable headless example using a consumer-supplied Yjs-compatible provider to load current paragraphs, insert text in an existing paragraph, observe a browser edit, and save from canonical state.
- [ ] 8.4 Add tests with independent browser and headless `TreePackageStore`/`Y.Doc` replicas for bidirectional sync, duplicate operation identity, reconnect with stable actor identity, unsupported/oversized agent output, committed-read isolation, and borrowed-resource teardown.
- [ ] 8.5 Add entry-point graph tests proving the headless path reaches no browser DOM, React, Vue, ProseMirror view, WebRTC, layout, or paint dependency.

## 9. Prove and stop

- [ ] 9.1 Add conformance fixtures that replay the same update sets through local, reordered, duplicated, disconnected, browser, and headless paths and compare canonical authored fingerprints.
- [x] 9.2 Prove converged replicas save and reopen with equal supported text, stable paragraph IDs, canonical fingerprints, and semantic digests while preserving fixture unknown OOXML.
- [ ] 9.3 Run scoped collaboration tests plus typecheck, lint, format, parallel and serial tests, parity, API, i18n, package/build graph, and strict OpenSpec validation.
- [ ] 9.4 Perform a manual test with two independently started localhost demos on separate machines, plus a local multi-browser and one-headless-agent test, and record reproducible room-link steps, results, and known network limits.
- [x] 9.5 Update feature-support docs to claim only the scenarios actually proven and leave unsupported collaboration capabilities explicit.
- [ ] 9.6 Stop after the smallest demo is verified; record that the next design must cover every canonical DOCX edit without a second exhaustive command protocol, then collect user feedback before specifying that model, durable hosting, or a docx-specific server helper.
