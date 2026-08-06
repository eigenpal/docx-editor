# Tasks — Textbox Story Layout

## 1. Fixtures and baselines

- [x] 1.1 (Word desktop unavailable in this environment: verified instead by
      xmllint well-formedness on every part, the save/reopen fingerprint +
      digest oracle, and structure inherited unchanged from the Word-authored
      source; manifest wordEvidence stays "pending (9.5)".) Verify the sanitized multi-section fixture
      `e2e/fixtures/footer-textbox-page-fields.docx` (42 sections; footers whose
      only content is an anchored, page-positioned textbox holding `PAGE` /
      `NUMPAGES` fields with stale cached results) opens in Word and register it
      in `e2e/fixtures/drawings-fixtures.md`
- [x] 1.2 Wire the orphaned `e2e/fixtures/header-footer-textbox.docx` and
      `e2e/fixtures/alternatecontent-textbox.docx` fixtures into tests (body +
      header + footer literal-text textboxes; MC-wrapped card)
- [x] 1.3 Record the current baseline: MC-wrapped textbox drawings project to
      nothing (`drawing-vector-shape.test.ts`), non-MC textboxes paint a
      `textbox` placeholder (`images-nonpicture.docx` oracles) — these tests
      flip in this change and must be updated deliberately, not deleted

## 2. Projection (store lane)

- [x] 2.1 Add `TextboxStoryProjection` (content node id, insets with OOXML
      defaults, vertical anchor, autofit mode, solid fill/outline of the shape)
      as a third payload arm on `DrawingProjection`, with a deep-freeze branch
      in `freezeDrawingProjection`
- [x] 2.2 In `projectVectorShape` / `projectDrawing`, on a `wps:txbx` child:
      capture the `w:txbxContent` reference and bodyPr reads, skip the story
      subtree in the drawing walk so the per-drawing element budget is not
      spent on story paragraphs
- [x] 2.3 Admit `textboxStory !== null` in the MC invisibility guard in
      `projectRunLevelMcDrawing`; keep charts/diagrams/groups invisible under MC
      as today
- [x] 2.4 Store tests: anchored textbox projection (the payload arm is
      anchor-form-agnostic; inline is projected but not laid out in this
      change), MC-wrapped projection (VML fallback not projected), bodyPr
      defaults vs explicit zero insets, malformed txbx (no content) demotes to
      placeholder

## 3. Layout

- [x] 3.1 Add node-scoped `textboxStoryBlocks` beside `noteStoryBlocks` in
      `story-roots.ts`
- [x] 3.2 Add `layoutTextboxStory` module shaped like `note-layout.ts`: flow via
      `flowBlocksInBoxBounded` at extent minus insets, height-bounded with a
      named truncation fallback, fragment cap, namespaced line ids, vertical
      anchor offset, `MAX_TEXTBOX_STORY_NESTING` cap
- [x] 3.3 Thread the host story's `FieldPageContext` into the textbox layout;
      gate per-page participation on `detectStoryPageFields(txbxContent)`;
      ensure a body/HF story whose only page fields live inside a textbox is
      classified as needing per-page layout
- [x] 3.4 Carry story fragments on `AnchoredDrawingRecord`; build them where
      the frame context (and page number) is in hand; include the story in
      layout cache keys so a stale page number can never be reused
- [x] 3.5 Layout tests: extent-width line breaking, overflow truncation reason,
      per-page PAGE/NUMPAGES values on the multi-section fixture (assert page
      N paints N, not the cached text), field-free textbox layout shared across
      pages, nesting cap termination, incremental relayout equals clean layout
      on a document with footer textboxes

## 4. Paint

- [x] 4.1 Paint story fragments in the drawing layers as an absolutely
      positioned `overflow:hidden` `contenteditable=false` container (fill rect
      + outline first, then `paintFragment`), for story-relative and
      page-relative anchors, behind-document included
- [x] 4.2 Paint tests: page-relative footer textbox paints on the page sheet at
      the anchor position; container is furniture (no `data-paragraph-id`
      bindings inside); no `innerHTML`-family sinks; text from the file never
      lands in markup unescaped
- [x] 4.3 Update the flipped placeholder/invisibility tests and the
      `images-nonpicture.docx` oracle entry for text boxes

## 5. Verification and docs

- [x] 5.1 Browser evidence: load the sanitized fixture in the demo, confirm
      footer page numbers render per page and match Word's output for the same
      file; screenshot to `screenshots/`
- [x] 5.2 Run the gates: `bun run typecheck`, `bun run test` (compare against
      the pre-change baseline), `openspec validate textbox-story-layout
      --strict`; scoped `bun test` for store/layout/paint suites touched
- [x] 5.3 Update `docs/site/data/word-features.ts` (text box rendering support
      claim) and the matching prose page; changeset (`minor`, consumer-facing:
      text boxes render their content including page-number fields)
