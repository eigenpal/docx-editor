## Why

The repository has accumulated overlapping engine and renderer proposals whose authority is now ambiguous, while the current implementation still mixes incomplete package modeling with superseded rendering paths. A single active change is needed to establish one typed, tree-backed OOXML authority and prove it through a paragraph editing slice before broader document features resume.

## What Changes

- Replace competing active proposals with one production authority for the paragraph vertical slice.
- Introduce one canonical ordered OOXML tree containing typed known nodes and generic unknown nodes, with semantic indexes derived from that same tree.
- Map ProseMirror transactions through `EditorBinding` into semantic `DocOp`s; ProseMirror remains an editing projection and is never canonical state, save input, or layout input.
- Define native page, paragraph-fragment, line, and style-span output over the canonical tree while retaining semantic interaction as the sole caret, selection, and hit-test authority.
- Carry `ModelChange` evidence into resumable incremental pagination, preserve unchanged page/display identity, virtualize page content, and publish cancellable global layout atomically.
- Serialize normalized OOXML from the canonical tree, preserving unsupported ordered content represented by generic nodes.
- Physically consolidate production `packages/engine-*` lanes into one guarded `packages/core` source tree and publish one `@docx-editor.dev/core` engine package with intentional environment-specific subpath exports.
- Make the first implementation checkpoint a browser-visible React paragraph editor: the existing `DocxEditor` hosts visible ProseMirror `contenteditable`, browser-native selection, native keymaps, writing, deletion, paragraph split/join, and save/reopen through `EditorBinding → DocOp → DocumentStore`.
- Stop at that checkpoint for hands-on user feedback before investing in comprehensive conformance matrices or replacing the visible ProseMirror surface with paginated semantic spans.
- After the feedback checkpoint, prove paginated behavior through the private React acceptance harness, then require React/Vue production parity before exposing it as supported behavior.
- Inventory tables, drawings, headers/footers, notes, fields, collaboration, deterministic export, and other non-paragraph features as deferred rather than implying support.

## Capabilities

### New Capabilities

- `typed-ooxml-canonical-tree`: One tree-backed typed OOXML model, generic ordered unknown nodes, derived semantic indexes, semantic mutation, and normalized serialization.
- `paragraph-editor-binding`: Paragraph ProseMirror projection, transaction-to-`DocOp` mapping, canonical reconciliation, and explicit rejection of PM-owned save/history/layout authority.
- `semantic-paragraph-layout`: Native page/paragraph-fragment/line/style-span layout output with semantic interaction authority.
- `single-core-package`: One physical production core source tree and one published engine package while preserving internal dependency and environment lanes.
- `paragraph-adapter-acceptance`: Private React proof, React/Vue production parity gates, baseline evidence, and explicit deferred-feature inventory.

### Modified Capabilities

None.

## Impact

The change governs the migration of all `packages/engine-*` source into `packages/core`, the resulting `@docx-editor.dev/core` subpath exports, and the React/Vue adapters. It resets OpenSpec authority and documentation references without restoring archived proposals or changing public support claims until the parity gates pass.
