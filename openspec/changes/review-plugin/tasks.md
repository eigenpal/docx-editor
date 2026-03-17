## 1. Package Scaffold

- [x] 1.1 Create `packages/agent-use/` with `package.json` (`@eigenpal/docx-editor-agent-use`, BSL-1.1, peer dep on `@eigenpal/docx-core`), `tsconfig.json`, `tsup.config.ts` with two entry points (`src/index.ts`, `src/bridge.ts`)
- [x] 1.2 Add BSL-1.1 `LICENSE` file (licensor: EigenPal, 4-year change date, MIT change license) — deferred, will add later
- [x] 1.3 Create source files: `src/index.ts`, `src/types.ts`, `src/errors.ts`, `src/DocxReviewer.ts`, `src/content.ts`, `src/discovery.ts`, `src/comments.ts`, `src/changes.ts`, `src/textSearch.ts`, `src/batch.ts`, `src/bridge.ts`
- [x] 1.4 Define types in `types.ts`: `ContentBlock`, `ReviewChange`, `ReviewComment`, `BatchResult`, `BatchError`, `GetContentOptions`, `ChangeFilter`, `CommentFilter`
- [x] 1.5 Define error classes in `errors.ts`: `TextNotFoundError`, `ChangeNotFoundError`, `CommentNotFoundError`
- [x] 1.6 Verify: `bun install` resolves workspace, `bun run build` produces dist with ESM + CJS + types

## 2. Document Reading — getContent

- [x] 2.1 Implement `getContent(options?)`: walk `body.content`, emit `ContentBlock` per block. Detect headings via styleId, list items via `listRendering`, tables as `{ type: 'table', rows: string[][] }`. Full text, no truncation.
- [x] 2.2 Implement chunked reading: `fromIndex`/`toIndex` params filter the output slice
- [x] 2.3 Implement tracked change annotations: insertions as `[+text+]{by:author}`, deletions as `[-text-]{by:author}` (default on, opt out via `includeTrackedChanges: false`)
- [x] 2.4 Implement comment anchor annotations: `[comment:id]text[/comment]` (default on, opt out via `includeCommentAnchors: false`)
- [x] 2.5 Write unit tests: plain doc, headings, tables, tracked changes annotated, comments annotated, chunked reading, no-truncation on large docs

## 3. Discovery — getChanges & getComments

- [x] 3.1 Implement `getChanges(filter?)`: walk paragraphs, collect `Insertion`/`Deletion`/`MoveFrom`/`MoveTo`, extract text, build context, group by revision ID. Filter: `author`, `type`.
- [x] 3.2 Implement `getComments(filter?)`: read `body.comments`, resolve `anchoredText` from range markers, nest replies by `parentId`. Filter: `author`, `done`.
- [x] 3.3 Write unit tests for discovery with real DOCX files containing tracked changes and comments

## 4. Text Search Helper

- [x] 4.1 Implement `findTextInParagraph(paragraph, search)` in `textSearch.ts`: returns `{ startRunIndex, startOffset, endRunIndex, endOffset }` or throws `TextNotFoundError`. Must handle text spanning multiple runs and tracked change wrappers.
- [x] 4.2 Write unit tests: single run, multi-run span, inside tracked changes, not found

## 5. Comment & Reply Operations

- [x] 5.1 Implement `addComment({ paragraphIndex, author, text, search? })`: whole-paragraph anchoring when no search, sub-paragraph when search provided. Generate comment ID, insert range markers.
- [x] 5.2 Implement `replyTo(commentId, { author, text })`: create reply with `parentId`
- [x] 5.3 Write unit tests: whole paragraph comment, sub-paragraph comment, reply, error cases

## 6. Change Proposals

- [x] 6.1 Implement `proposeReplacement({ paragraphIndex, search, author, replaceWith })`: wrap matched text in `Deletion`, insert `Insertion` with replacement
- [x] 6.2 Implement `proposeInsertion({ paragraphIndex, author, insertText, position, search? })`: insert `Insertion` at paragraph start/end or adjacent to search match
- [x] 6.3 Implement `proposeDeletion({ paragraphIndex, search, author })`: wrap matched text in `Deletion`
- [x] 6.4 Write unit tests: propose → getChanges shows new changes, propose → accept → correct text, propose → reject → unchanged

## 7. Accept & Reject

- [x] 7.1 Implement `acceptChange(id)` and `rejectChange(id)`: find tracked change by ID across all paragraphs, unwrap/remove as appropriate
- [x] 7.2 Implement `acceptAll()` and `rejectAll()`: iterate all, return count
- [x] 7.3 Write unit tests including round-trip: accept → serialize → parse → verify

## 8. Batch & Export

- [x] 8.1 Implement `applyReview(ops)`: process in order (accept/reject → comments → replies → proposals), collect errors. Return `BatchResult`.
- [x] 8.2 Implement `toDocument()` and `toBuffer()`: serialize via core, repack via core's `repackDocx`
- [x] 8.3 Implement `DocxReviewer.fromBuffer(buffer)` static factory
- [x] 8.4 Write unit tests: batch with partial failures, empty batch, full round-trip export

## 9. Bridge (Client-Side, Optional)

- [ ] 9.1 Implement `createReviewBridge(editorRef)` in `bridge.ts`: returns object with same method signatures, internally maps paragraph indices / change IDs to PM positions
- [ ] 9.2 Write Playwright E2E tests: load DOCX → call bridge methods → verify rendering

## 10. Integration Tests

- [ ] 10.1 Full headless workflow: parse DOCX → getContent → getChanges → accept/reject → addComment → export → re-parse → verify
- [ ] 10.2 Simulated agent workflow: getContent → feed to mock LLM → applyReview batch → export → verify comments and tracked changes in output
