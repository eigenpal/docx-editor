## Why

AI agents reviewing documents (legal contracts, compliance docs, editorial content) need to programmatically read document content, accept/reject tracked changes, and add comments — without a browser or DOM. Today, the editor has full OOXML parsing/serialization for track changes and comments, but exposes none of it through a high-level API. The only way to accept a change is via ProseMirror positions (`acceptChange(from, to)`), which are meaningless to an agent.

Separate package (`@eigenpal/docx-editor-agent-use`) under BSL-1.1 — source-available, free for non-production, paid subscription for commercial use.

## What Changes

- **New package** `packages/agent-use/` → `@eigenpal/docx-editor-agent-use` (BSL-1.1)
- **`DocxReviewer` class**: 14-method API — read, discover, comment, propose changes, resolve, batch, export
- **`paragraphIndex` as primary anchor**: agent sees `{ index: 15, text: '...' }` from `getContent()`, references paragraph 15 directly. `search` is optional refinement within a paragraph for sub-paragraph targeting.
- **Chunked reading**: `getContent({ fromIndex, toIndex })` for long documents
- **Batch**: `applyReview()` single call for full document review
- **Headless-first**: works on Document model, no ProseMirror/DOM needed

## Capabilities

### New Capabilities

- `review-reading`: `getContent()` returns structured, LLM-friendly document with inline tracked change/comment annotations, supports chunked reading via `fromIndex`/`toIndex`
- `review-discovery`: `getChanges()` and `getComments()` return agent-friendly objects with text, context, and IDs
- `review-actions`: Comment by paragraph index, propose insertions/deletions/replacements, accept/reject changes by ID, batch operations
- `review-packaging`: Separate BSL-licensed package with peer dependency on core

### Modified Capabilities

## Impact

- **New package**: `packages/agent-use/` with own `package.json`, `tsconfig.json`, `tsup.config.ts`, BSL-1.1 `LICENSE`
- **Peer dependency**: `@eigenpal/docx-core` — no code duplication
- **Core package**: No changes
- **Breaking changes**: None — purely additive
