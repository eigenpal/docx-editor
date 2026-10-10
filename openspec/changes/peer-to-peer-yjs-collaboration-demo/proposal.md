## Why

The v2 editor removed v1's ProseMirror-owned Yjs integration and currently has no honest collaboration path, while users are asking for shared editing and the docs still claim realtime Yjs support. We need the smallest tree-authoritative proof that two browsers—and a headless automation client—can synchronize existing paragraph text without introducing a second document authority or committing to unsupported structural collaboration.

## What Changes

- Add a provider-neutral collaboration session contract that routes local and remote authored changes through the canonical `TreeDocumentStore` transaction path with explicit local, remote, awareness, and undo origins.
- Add an optional Yjs integration that synchronizes insertion and deletion inside existing body paragraphs, using persistent Word paragraph identities and Yjs-relative positions while keeping layout and save tree-authoritative.
- Add creator/joiner bootstrap semantics that transfer one bounded immutable DOCX baseline, reject competing or mismatched initialization, and expose readiness, connection, error, and teardown state.
- Add a peer-to-peer WebRTC convenience integration and runnable two-browser demo using `y-webrtc`, with public or consumer-supplied signaling and ICE configuration and no docx-editor-operated service.
- Add awareness-based user presence and remote collapsed/range selections without writing awareness into document revision, history, snapshots, or DOCX output.
- Add actor-local collaborative undo for the supported text slice; remote changes must never enter or be removed by another actor's undo.
- Allow a DOM-free automation or AI-agent process to join the same provider-neutral Yjs session, read the canonical document through the headless API, submit supported edits through existing automation transactions, and synchronize them without rendering.
- Add adversarial two/three-replica proof gates for concurrent text, delivery order, duplicate updates, disconnect/reconnect, undo ownership, awareness isolation, bounded bootstrap, and DOCX save/reopen equivalence.
- Correct current docs and examples so the repository no longer claims full collaboration; document this change as an experimental, deliberately bounded proof.
- Stop implementation at the verified smallest demo. Paragraph creation/split/join, formatting, comments, tracked changes, tables, headers/footers, notes, drawings, durable shared hosting, permissions, and production server helpers remain future decisions.
- Record the post-proof product goal: a later design must support every canonical DOCX edit, including all stories, structures, media, and review data, without creating a second hand-maintained editor protocol. The complete replication model remains deliberately TBD until this proof provides evidence.
- Make the proof runnable from two separate development machines: each person starts the repository demo on localhost, opens or joins the same room through public or configured signaling, and observes direct synchronized edits.

## Capabilities

### New Capabilities

- `yjs-collaboration-session`: Provider-neutral, tree-authoritative Yjs synchronization for text insertion/deletion in existing body paragraphs, awareness, actor-local undo, bounded baseline bootstrap, lifecycle, and convergence.
- `p2p-webrtc-collaboration`: Consumer-configured WebRTC room creation/joining and a runnable peer-to-peer proof with no docx-editor-operated backend.
- `headless-collaboration-client`: DOM-free automation and AI-agent participation in the same collaboration session through canonical reads and validated supported edits.

### Modified Capabilities

None.

## Impact

- New collaboration contracts and a guarded optional sync lane/package that may import `@docx-editor.dev/core/store` but does not make core's default editor bundle import Yjs or any provider.
- Optional peer dependencies on stable Yjs 13.x and, only for the convenience entry point/example, `y-webrtc`; provider lifecycle remains consumer-owned at the low-level API.
- `TreeDocxSession.applyTreeOps`, automation apply ports, `TreePackageStore`, and history handling plumb the existing frozen human/agent/remote/undo origins plus actor and operation identity needed for remote commits, duplicate detection, and collaborative undo isolation.
- The editor output layer gains a non-editable remote-selection overlay derived from semantic layout geometry.
- React exposes thin construction/lifecycle glue only; editing state remains in the engine/collaboration session, and the headless path stays DOM-free.
- `@docx-editor.dev/editor-api` or the core automation host gains an attachment path to an externally supplied collaboration session, not a hosted service or new document model.
- Conformance fixtures, package/API snapshots, examples, docs feature claims, and a consumer-facing changeset are affected.
