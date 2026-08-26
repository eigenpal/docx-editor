## 0. Freeze architecture and scope

- [x] 0.1 Define full collaboration as coverage of a frozen authorable mutation manifest, without implementing missing editor capabilities.
- [x] 0.2 Separate client, provider, server, storage, migration, and offline support claims.
- [x] 0.3 Require server-only document synchronization for authorized rooms and target documented `y-websocket` compatibility.
- [x] 0.4 Require new room generations for restore, destructive reset, representation migration, and compaction.
- [x] 0.5 Generate the authorable mutation manifest from the implementation base commit and record active OpenSpec dependencies.
- [x] 0.6 Define exact deterministic pull request budgets and maintained hardware benchmark budgets.

## 1. Close the bounded proof and freeze baselines

- [x] 1.1 Complete the remaining isolated-browser creator/joiner, disconnect, unsupported-control, and URL-contract tests in `peer-to-peer-yjs-collaboration-demo`.
- [x] 1.2 Complete independent browser/headless bidirectional, duplicate-identity, reconnect, oversized-output, committed-read, and teardown tests.
- [x] 1.3 Complete proof conformance permutations and compare canonical fingerprints and save/reopen semantic digests.
- [ ] 1.4 Record the successful Vercel two-window proof and complete a separate-machine plus headless manual run. Browser verification of the full-document demo is running separately and is NOT yet confirmed.
- [ ] 1.5 Run and record every proof verification gate, then mark its stop task complete without widening proof scope.
- [ ] 1.6 Archive the bounded proof or record the exact active-change dependency before full-document integration starts.
- [x] 1.7 Capture local edit allocation, dirty scope, layout cache hits, paint latency, memory, and update size on the existing 200-page benchmark.

## 2. Build the shared-representation spike

- [x] 2.0a Inventory canonical tree and package writes before freezing the backend contract.
- [x] 2.0b Define the smallest complete primitive journal before selecting registry record fields.
- [x] 2.0c Run a minimal nested Yjs XML move kill test before implementing its complete backend.
- [x] 2.1 Add one scratch-only harness outside production import graphs with two independent `Y.Doc` replicas and no provider.
- [x] 2.2 Implement the same bounded backend contract for nested Yjs XML and a stable-node registry with replicated child-ID sequences.
- [x] 2.3 Define replicated logical node metadata independently from Yjs item IDs and Word-facing IDs.
- [x] 2.4 Materialize a correct frozen `OoxmlPart` from each backend and pass canonical fingerprint plus validation round trips.
- [x] 2.5 Derive equivalent dirty paths from XML events and registry deltas, then invalidate only changed ancestors.
- [x] 2.6 Rebuild changed children with one scratch-only bounded range replacement helper and preserve unaffected references.
- [x] 2.7 Run concurrent same-offset text, different-paragraph text, attribute, and run-formatting cases on both backends.
- [x] 2.8 Run concurrent paragraph split/type, delete/type, join/type, and table-row insertion cases on both backends.
- [x] 2.9 Run move and reparent cases with concurrent source, destination, and descendant edits on both backends.
- [x] 2.9a Compare child-array and parent-register authority under move, cycle, delete, join, undo, and incremental materialization schedules.
- [x] 2.9b Select child arrays as registry membership authority, tombstone deleted records, and use `replacedBy` for joins.
- [x] 2.10 Run comment anchor, revision wrapper, content-control, unknown-node, and invalid-placement cases on both backends.
- [x] 2.11 Measure canonical allocations, materialization, layout cache hits, dirty scope, paint latency, memory, update bytes, snapshot bytes, and undo for both backends.
- [x] 2.12 Run `validateOoxmlPart`, delta validation, canonical fingerprint, and serialize/reopen semantic digest for every backend and delivery order.
- [x] 2.13 Publish a comparison report that records every invariant issue code and every pass, optimization, or kill result.
- [x] 2.14 Enforce the fewer-than-three-times allocation pass gate and the ten-times-or-more kill gate in benchmark tests.
- [x] 2.15 Enforce the move kill gate when concurrent edits or stable logical identity cannot survive.
- [x] 2.16 Select only a candidate that passes every gate and record the measured reason for the selection.
- [x] 2.17 Confirm the stop rule did not trigger because the stable-node registry passed every gate.
- [x] 2.18 Prove room generation replacement, old-generation rejection, and rollback by active-generation switch.
- [x] 2.19 Prove blob upload leases, delayed bytes, missing bytes, retained-generation references, and safe garbage collection.
- [ ] 2.20 Prove server rejection forces replica disposal and clean active-generation rejoin.
- [x] 2.21 Prove transaction attribution limits across merged offline updates and define trusted server audit ownership.

## 3. Prove the canonical mutation boundary

- [x] 3.1 Inventory every canonical tree, package, relationship, content-type, and binary write path outside tests.
- [x] 3.2 Map all 69 `TreeDocOp` kinds to the five existing tree primitives and record that `replaceChildRange` does not exist.
- [x] 3.3 Identify package-level mutations that child splices cannot represent, including part lifecycle, binary lifecycle, and relationship sidecars.
- [x] 3.4 Define the smallest text, attribute, namespace, child-splice, move, part, relationship, content-type, and binary-reference journal.
- [x] 3.5 Add a transaction-local primitive journal behind existing canonical operations without changing non-collaborative output.
- [ ] 3.6 Route every direct canonical write through the primitive boundary or document one required new compositional primitive.
- [ ] 3.7 Add source and lane guards that reject new writes which bypass the primitive boundary.
- [ ] 3.8 Add mutation-coverage fixtures proving every current `TreeDocOp` emits a complete deterministic journal.
- [ ] 3.9 Prove journal capture adds no observable revision, identity, history, save, or performance change when collaboration is absent.

## 4. Implement the versioned full-package shared model

- [x] 4.1 Define protocol, shared-schema, repair, and canonical-model version metadata with strict bounds.
- [x] 4.2 Put the production registry in `packages/collaboration-yjs/src/document/` with `DocumentRegistry`, `seedPackage`, `applyPrimitiveJournal`, `PackageMaterializer`, `LogicalIdAllocator`, and `MemoryBlobStore`. Child-ID arrays are the only replicated membership. Records store no parent field. The parent index is derived. Deletes tombstone. Joins set `replacedBy`.
- [x] 4.3 Map locally minted canonical node ids to replica-scoped logical ids through `LogicalIdentityMap` in `packages/collaboration-yjs/src/document-identity.ts`.
- [x] 4.3a Record that a minted canonical id has the shape `<partName>#new:<counter>`. The counter is scoped to one part. Two replicas that start from the same baseline bytes mint the SAME id for DIFFERENT nodes. Shared state keyed on that id merges the two nodes and destroys one author's content.
- [x] 4.3b Reject process-wide `setNodeIdMintScope` in `packages/core/src/store/package/ooxml-edit.ts`. Two replicas in one process share module state. The last attach won, so the scope changed ids without making them unique. Core is unchanged. `packages/core/src/store/__tests__/ooxml-edit.test.ts` pins that two documents opened from the same bytes mint the SAME ids.
- [ ] 4.4 Define deterministic Word-facing paragraph, comment, revision, relationship, drawing, bookmark, note, and numbering ID allocation and collision repair.
- [ ] 4.5 Define XML part create, delete, and reference-update transactions while capability-gating rename.
- [x] 4.6 Carry binary bytes in `Y.Map` `docx-package-blobs-v1`, keyed by digest, capped at 64 MiB total. Digests are immutable, so two replicas writing one key write the same bytes.
- [ ] 4.7 Add consumer-supplied blob put, get, retain, and release contracts. Blob lease and garbage collection stay deferred.
- [x] 4.8 Seed a complete validated OPC package and required blob descriptors in one bounded room initialization.
- [ ] 4.9 Join and reconstruct a complete package only after schema, resource, part, relationship, and blob validation.
- [x] 4.9a Call `registry.rebuildDerivedIndexes()` once after the join handshake. Shared state can arrive before the registry exists, and the derived parent index is built from child-array events.
- [x] 4.10 Apply one validated local primitive journal as one Yjs transaction tagged with a local origin.
- [x] 4.11 Materialize one canonical package revision from one local or remote shared transaction.
- [x] 4.11a Install one already-agreed package as one canonical revision through `TreePackageStore.publishRemotePackage` and `CollaborationDocumentPort.applyRemotePackage`. Record no legacy history and emit no primitive journal.
- [x] 4.11b Bypass the local shell merge with `installAuthoritativePackageSnapshot`. Merging local numbering over an agreed remote package reverted remote list edits forever.
- [ ] 4.12 Derive package dirty sets, changed logical IDs, and layout dependency keys from selected-backend events.
- [x] 4.13 Keep layout, paint, automation reads, and serialization isolated from mutable Yjs types.
- [x] 4.14 Add duplicate and no-change update tests that preserve canonical revision and page identity.
- [x] 4.15 Export `createDocumentCollaboration` from `packages/collaboration-yjs/src/document-session.ts`. Call it from `packages/collaboration-yjs/src/webrtc.ts` instead of paragraph-only `createTextCollaboration`.
- [x] 4.16 Admit every authorable mutation in `gateOperations`. Refuse only an unready, unattached, or destroyed session.
- [x] 4.17 If `applyPrimitiveJournal` refuses a local journal, set status `error` and republish shared state over the local store. Shared state is the authority.
- [x] 4.18 Track one `Y.UndoManager` over the registry's tracked types with the local origin.
- [x] 4.19 Cover joiner catch-up, text, formatting, paragraph structure, table, concurrent creation, concurrent text, note conversion, undo, gate, and duplicate delivery in `packages/collaboration-yjs/src/__tests__/document-session.test.ts`. Two concurrent-creation tests fail if the identity mapping is disabled.
- [x] 4.19a Rename one element in place when `putNode` names a node shared state already holds. A note conversion changes only the qualified name, so minting a new logical id left the original element unchanged and added an orphan beside it, with no refusal.
- [ ] 4.19b Materialize each `.rels` part to agree with the shared relationship records. The lowering suppresses the `.rels` tree splice, but `writeOoxmlPackage` serializes part trees, so a received relationship is missing from the saved bytes.
- [x] 4.19c Validate each journal effect against the state its predecessors leave behind. Checking every bound against the pre-journal state refused ordinary typing, because the surface appends a scratch `w:t`, splices the character into the neighbour, then removes the scratch.
- [ ] 4.19d Compact the shared node encoding. A 36 KiB document seeded 12,196 nodes and encoded to 6.3 MiB, about 520 bytes per node, which no WebRTC data channel delivers as one update — so every joiner timed out while the host looked healthy. Four eager Yjs types per element, a repeated namespace URI, eight map keys, and `deleted: false` carry that cost.
- [ ] 4.20 Rewrite `[Content_Types].xml` bytes after override edits.
- [ ] 4.21 Rerun the 200-page layout and paint collaboration budget after full-document integration.

## 5. Add deterministic repair and quarantine

Quarantine and repair origins remain deferred.

- [ ] 5.1 Enumerate repairable invariant issue codes from the spike and assign stable rule versions and ordering.
- [ ] 5.2 Implement bounded idempotent repair for duplicate parent references and unambiguous structural normalization.
- [ ] 5.3 Implement deterministic collision repair for Word-facing IDs without changing logical node identity.
- [ ] 5.4 Preserve unknown content by generic demotion when placement is invalid but semantics remain lossless.
- [ ] 5.5 Refuse repair that chooses user text, invents review intent, or drops unknown content.
- [ ] 5.6 Publish pure canonical repairs under `ORIGIN_IDS.mutationRepair` without competing Yjs writes and exclude them from actor undo.
- [ ] 5.7 Record bounded structured audit facts for repair decisions without document-content logs.
- [ ] 5.8 Keep the last valid canonical package when repair or validation fails.
- [ ] 5.9 Add typed quarantine status that blocks authoring, save, export, and unsupported migration.
- [ ] 5.10 Add administrator checkpoint restore and explicit reset paths that validate before leaving quarantine.
- [ ] 5.11 Prove every repair converges, becomes a no-op on replay, and respects resource budgets.
- [ ] 5.12 Add explicit versioned idempotent maintenance operations for the limited repairs that must normalize shared state.

## 6. Admit every canonical mutation class

- [ ] 6.1 Admit text insertion, deletion, replacement, run split/merge, and character formatting across every story root.
- [ ] 6.2 Admit paragraph creation, split, join, delete, reorder, properties, borders, tabs, numbering, and styles.
- [ ] 6.3 Admit table creation, row and column operations, cell properties, grid changes, merges, and nested tables.
- [ ] 6.4 Admit section boundaries, page properties, header/footer references, and header/footer story edits.
- [ ] 6.5 Admit footnote, endnote, field, bookmark, hyperlink, and content-control operations.
- [ ] 6.6 Admit comment bodies, anchors, replies, resolution, deletion, and stable review attribution.
- [ ] 6.7 Admit tracked insertions, deletions, formatting revisions, moves, accept, reject, and nested author attribution.
- [ ] 6.8 Admit drawing, image, shape, text box, VML, relationship, crop, geometry, and alternative-content edits.
- [ ] 6.9 Admit custom nodes and every lossless generic OOXML mutation allowed by canonical validation.
- [ ] 6.10 Admit XML part, relationship part, content type, custom XML, and supported package metadata lifecycle.
- [ ] 6.11 Admit binary image, embedded font, and other inert resource lifecycle through blob references.
- [ ] 6.12 Keep each incomplete mutation class refused before local or shared mutation. The experimental session no longer class-filters at `gateOperations`. A journal that cannot apply sets status `error` and republishes shared state.
- [ ] 6.13 Add local, reversed, delayed, duplicated, disconnected, repaired, checkpointed, and cross-runtime fixtures for each class.
- [ ] 6.14 Remove the experimental client-support qualifier only when every frozen manifest row passes.

## 7. Complete undo, lifecycle, migration, and offline behavior

- [ ] 7.1 Expand actor-scoped `Y.UndoManager` coverage to every admitted shared type and primitive. The experimental session tracks registry types with a local origin. Actor-scoped undo for the full package remains deferred.
- [ ] 7.2 Group each compound canonical command into one shared undo item.
- [ ] 7.3 Prove undo and redo preserve remote edits, repair outcomes, tracked revision semantics, blobs, and package validity.
- [ ] 7.4 Add bounded transient-disconnect buffering and reconnect convergence for browser and headless clients.
- [ ] 7.5 Document that process-closing offline durability requires a future optional local persistence adapter.
- [ ] 7.5a Keep managed offline frames ordered and unmerged until receipt, then stop submission at the first NACK.
- [ ] 7.6 Define validated room checkpoints with schema versions, state vectors, last valid canonical identity, and required blobs.
- [ ] 7.7 Add reset-only compatibility for incompatible experimental room schemas.
- [ ] 7.8 Add deterministic additive migrations that build and validate a replacement room generation.
- [ ] 7.9 Add administrative maintenance locks, atomic generation activation, old-client rejection, and rollback by generation switch.
- [ ] 7.10 Make an externally edited DOCX create a new room by default.
- [ ] 7.11 Add explicit administrative DOCX reset that rejects connected writers, durably retains the old generation, and records audit facts.

## 8. Build the optional Bun and Node server module

- [ ] 8.1 Scaffold the optional server package with no import from default core, React, Vue, layout, paint, or ProseMirror entries.
- [ ] 8.2 Define portable server room, HTTP-upgrade authentication, authorization, storage-facet, blob, checkpoint, audit, and export contracts.
- [ ] 8.3 Implement room-level `read`, `edit`, and `admin` authorization with consumer callbacks.
- [ ] 8.4 Implement documented `y-websocket` sync and awareness framing plus versioned extension messages.
- [ ] 8.5 Implement memory storage that preserves rooms while the process runs.
- [ ] 8.6 Implement safe single-instance file storage with path validation, exclusive root locking, atomic rename, restart recovery, and multi-instance refusal.
- [ ] 8.7 Define and test production maintenance locking plus active-generation compare and swap without requiring one database or object store.
- [ ] 8.8 Implement content-addressed blob storage hooks, durable leases, ordered persistence, all pin reasons, and race-safe garbage collection.
- [ ] 8.9 Implement update, awareness, rate, client, room, element, depth, text, checkpoint, and blob limits.
- [ ] 8.10 Validate each update in isolated candidate state before authoritative persistence and broadcast.
- [ ] 8.10a Implement server-side canonical materialization, repair, quarantine, and DOCX export without DOM dependencies.
- [ ] 8.11 Implement checkpoint, restore, retention, deletion, and explicit reset administrative operations.
- [ ] 8.12 Implement health, lifecycle, timing, count, outcome, and version observability hooks without content or secret logs.
- [ ] 8.13 Add Bun and Node runnable examples with TLS deployment guidance and host-controlled storage encryption guidance.
- [ ] 8.14 Prove browser and headless clients can switch between peer-to-peer, hosted provider, and server transport without editor API changes.
- [ ] 8.15 Document that the server is readable and that end-to-end encrypted rooms are not supported by server validation/export.
- [ ] 8.16 Disable direct peer document synchronization for authorized server rooms.
- [ ] 8.17 Dispose and rejoin a client replica after authorization or semantic update rejection.
- [ ] 8.18 Add authenticated HTTP administration for room creation, export, checkpoint, restore, migration, reset, and deletion.
- [ ] 8.19 Add managed transaction frames, immutable client-ID ownership, bounded receipts, ACK/NACK, and snapshot rebase.
- [ ] 8.20 Reject mixed-client new struct ranges and bind delete-only frames through the authenticated connection.

## 9. Harden security, packaging, and public APIs

- [ ] 9.1 Apply DOCX trust-boundary sanitization and resource limits to all shared schema, checkpoint, blob, and server inputs.
- [ ] 9.2 Add hostile URL, path traversal, prototype key, excessive depth, decompression, entity, field, OLE, and external-fetch fixtures.
- [ ] 9.3 Add pre-transport byte limits where provider APIs permit and quarantine before canonical allocation otherwise.
- [ ] 9.4 Keep Yjs and server dependencies optional and enforce one engine copy through package dependency tests.
- [ ] 9.5 Add public TSDoc, API snapshots, package exports, notices, and consumer install/build tests.
- [ ] 9.6 Add framework-neutral status, capability, quarantine, audit, and server contracts without exposing mutable Yjs types from core.
- [ ] 9.7 Add React glue and equivalent future-adapter seams without adapter-owned editing state.
- [ ] 9.8 Update feature support, architecture, server deployment, room lifecycle, migration, security, offline, and external-DOCX documentation.
- [ ] 9.9 Add a new consumer-facing minor changeset for client replication support.
- [ ] 9.10 Add a separate changeset and fixed-group package entry if the server package becomes publishable.
- [ ] 9.11 Publish `@docx-editor.dev/collaboration-server` under Apache-2.0 with Node 22 and Bun 1.3 engine documentation.
- [ ] 9.12 Document that Yjs origin and peer-to-peer actor names are not authenticated attribution.

## 10. Prove full support and release

- [ ] 10.1 Run every frozen manifest row through the maintained deterministic pairwise and three-replica schedule corpus.
- [ ] 10.2 Save and reopen every converged fixture and compare semantic digests, relationships, unknown content, and binary resources.
- [ ] 10.3 Run the complete 200-page allocation, layout-cache, dirty-scope, paint, memory, update-size, checkpoint-size, and reconnect benchmark matrix. The full-document layout and paint budget rerun remains deferred.
- [ ] 10.4 Run browser, headless Bun, headless Node, peer-to-peer, persistent-server, restart, checkpoint, migration, and quarantine recovery tests.
- [ ] 10.4a Test spoofed client IDs, delete-only binding, dropped clock gaps, NACK rebase, merged offline batches, and empty restored undo.
- [ ] 10.5 Run typecheck, format, lint, parallel tests, serial tests, parity, API, i18n, package, bundle, security, and strict OpenSpec gates.
- [ ] 10.6 Perform separate-machine manual tests for every supported transport and record NAT, TURN, reconnect, authorization, persistence, and export results.
- [ ] 10.7 Verify public docs claim only measured experimental milestones until the full matrix passes.
- [ ] 10.8 Declare client replication support only after every frozen manifest row passes.
- [ ] 10.9 Declare server, storage, migration, and offline support separately after their specific gates pass.
