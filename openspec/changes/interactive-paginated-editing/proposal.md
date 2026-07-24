## Why

The production adapters can repaint canonical document state as paginated
output, but that output is still a passive projection: pointer hit testing,
caret and selection geometry, direct page interaction, viewport
virtualization, and public-adapter browser evidence are incomplete. Calling a
separate edit-and-preview composition "WYSIWYG" obscures the missing interaction
contract and permits feature claims without proving that users can edit the
rendered result.

## What Changes

- Define one normal interactive paginated surface for React and Vue. Users
  click, select, type, format, use clipboard and IME, and navigate directly on
  the engine-painted pages.
- Keep the authored `DocumentStore` canonical, ProseMirror as the hidden editing
  engine, and the positioned display list as the sole visible geometry
  authority. Paginated ProseMirror DOM is explicitly not a second layout
  authority.
- Add an engine-owned interaction plane that maps client-space pointer input
  through layout hit testing to semantic positions and maps current semantic
  selections back to caret and selection overlay geometry.
- Require display, selection geometry, and committed revision to publish
  atomically. Pending asynchronous layout retains the last committed
  interaction snapshot rather than mixing revisions.
- Make split edit/preview an opt-in diagnostic mode. It is not the normal
  adapter composition and cannot satisfy browser conformance.
- Add viewport-scoped page painting, bounded input-path work, scroll and
  autoscroll behavior, and a measured 300–500-page gate. Start with a complete
  hidden ProseMirror projection; permit a bounded mounted editing window only
  after equivalent behavior and measured need are proven.
- Allow incremental feature delivery. A capability may expose generic fallback
  editing only when it declares ownership, forward/reverse mapping, rejection
  boundaries, interaction behavior, and save/reopen evidence. Otherwise its
  content remains visible and read-only.
- Reconcile active provisional contracts: replace flat display-offset geometry
  with PM-free semantic/frame-bound targets, clarify that geometry-aware
  gestures still become native ProseMirror selections through `EditorBinding`,
  permit capability-owned selective edits within one safe top-level block in a
  partial document, and scope structural feature claims to the exact proven
  operation matrix.
- Separate two claims:
  - **interactive paginated editing** means a supported feature is directly
    editable on the rendered pages;
  - **feature WYSIWYG** is earned feature by feature only after authored,
    layout, display, interaction, and save/reopen evidence passes.
- Replace the misleading landed "WYSIWYG" checkpoint wording with "paginated
  preview repaint" and leave broad binding, layout, adapter, feature-fidelity,
  partial-editability, and package-topology tasks open until their actual gates
  pass.
- **Accelerated delivery:** after task **5.5** and the body-paragraph safety
  subsets **5.6a** and **5.7a**, port presentation and user-visible shell
  behavior component-by-component from the polished retired editor shell at git
  ref the recorded presentation baseline around the greenfield production
  adapter. React internal alpha lands first; Vue parity is required before the
  paired bounded-document internal/preview alpha at **M6**. The first formal
  public **`interactive-paginated`** claim remains task **8.10** after async
  layout, virtualization, and performance gates. Retired geometry, pagination,
  flow/painter models, and ProseMirror adapter authority are never restored.

## Capabilities

### New Capabilities

- `interactive-paginated-editing`: Unified paginated editing surface,
  interaction/display revision contract, semantic hit testing, caret and
  selection overlays, focus/keyboard/clipboard/IME routing, capability-proven
  fallback editing, viewport virtualization, paired-adapter behavior, and
  evidence required for per-feature WYSIWYG claims.

### Modified Capabilities

None in the archived baseline under `openspec/specs/`. This change directly
reconciles the still-active provisional `document-engine`,
`comprehensive-ooxml-prosemirror-coverage`, `partial-body-editability`, and
`simplified-core-editor-contract` source changes while retaining their
independent completion authority.

## Impact

- `packages/engine-editor`: interaction snapshot, geometry facade, focus and
  selection routing, revision coherence, scheduling, and virtualization
  coordination.
- `packages/engine-binding`: semantic-position/ProseMirror selection bridge,
  visual navigation hooks, clipboard, composition, and optional bounded-view
  strategy behind the PM-free editor facade.
- `packages/engine-layout` and `packages/engine-output`: model-derived document
  positions, cluster/affinity hit testing, caret/range geometry, hit ownership,
  page-window display data, and safe positioned paint.
- `packages/react` and `packages/vue`: identical thin page, overlay, pointer,
  keyboard-focus, scroll, and autoscroll composition through public
  `Editor`/`EditorHost` contracts.
- Browser conformance: public-adapter `EditorDriver` scenarios replace the
  example-only split-pane path for interaction acceptance.
- No new canonical state, DOCX wire format, or adapter-owned layout semantics.
