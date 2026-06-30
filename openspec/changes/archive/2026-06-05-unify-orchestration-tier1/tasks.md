Each numbered group is one independently-shippable PR. Land in order (1 is a dependency of 2/4/8). Per-PR gate: `bun run typecheck` → targeted Playwright `--grep` in both adapters → `api:extract` + `check:parity-contract` where noted → `bun changeset` (patch) → `bun run format`.

## 1. paraText helpers → core (foundation)

- [ ] 1.1 Diff React (`internals/pmAnchors.ts:52-64`, `internals/vanillaText.ts:13-93`) vs Vue (`utils/paraTextHelpers.ts`) copies; note any drift
- [ ] 1.2 Create `packages/core/src/prosemirror/paraText.ts` with `findParaIdRange`, `findTextInPmParagraph`, `getVanillaNodeText`, `getVanillaTextBetween` (canonical = more complete copy if drifted)
- [ ] 1.3 Add `./prosemirror/paraText` to `packages/core/package.json` exports
- [ ] 1.4 React: convert `pmAnchors.ts` / `vanillaText.ts` paraText functions to re-exports from core
- [ ] 1.5 Vue: convert `utils/paraTextHelpers.ts` to re-export from core; remove the `TODO(file-size-cap)`
- [ ] 1.6 Core unit test: `paraText.test.ts` — `findParaIdRange` hit/miss, `findTextInPmParagraph`, vanilla text extraction over ranges
- [ ] 1.7 Verify: `bun run typecheck`; core unit test; Playwright `formatting`, `comments-sidebar`, `text-editing`; `bun changeset`

## 2. Query helpers → core

- [ ] 2.1 Create `packages/core/src/prosemirror/queries.ts` with pure `findInDocument(view,query,opts?)`, `getSelectionInfo(view)`, `getPageContent(view,layout,pageNumber)` (reuse core paraText)
- [ ] 2.2 Add `./prosemirror/queries` to core exports
- [ ] 2.3 Vue: `utils/refApiQueries.ts` re-exports from core
- [ ] 2.4 React: `useDocxEditorRefApi.ts:383-485` ref methods delegate to core, passing `getView()` / `getLayout()`
- [ ] 2.5 Core unit test: `queries.test.ts` — `findInDocument` ordering/dedup/`caseSensitive`/`limit`, `getSelectionInfo` null + non-empty, `getPageContent` valid + out-of-range
- [ ] 2.6 Verify: typecheck; core unit test; `comments-sidebar` + any agents/find specs; `api:extract` + `check:parity-contract`; `bun changeset`

## 3. domSelection dedup + cell-selection highlight → core

- [ ] 3.1 React: delete `getCaretFromDom` (`domSelection.ts:29-113`) walk logic; keep a thin shim resolving overlay rect + zoom, delegating to core `getCaretPositionFromDom`
- [ ] 3.2 React: same for `computeSelectionGeometryFromDom` (`:123-192`) → core `readSelectionGeometry`
- [ ] 3.3 Create `packages/core/src/flow-model/cellSelectionHighlight.ts` from `applyCellSelectionHighlight` (`domSelection.ts:204-255`); add export key
- [ ] 3.4 React: wire `useSelectionOverlay.ts:113` and `DocxEditorPagedArea.tsx:257` to the core function
- [ ] 3.5 Vue: call `applyCellSelectionHighlight` from `useSelectionSync.ts` (new wiring — closes Vue gap)
- [ ] 3.6 Add a zoom≠1 caret-position assertion (React shim must match the prior zoom path); add an **automated Vue spec** asserting multi-cell selection paints `.layout-table-cell-selected`
- [ ] 3.7 Verify: typecheck; selection/alignment specs + `comments-sidebar` in both adapters; `bun changeset`

## 4. applyFormatting + setParagraphStyle → core

- [ ] 4.1 Create `packages/core/src/prosemirror/applyFormatting.ts`: `applyFormatting(view,options,{getStyleResolver})` + `setParagraphStyle(view,options,{getStyleResolver})`; standardize on the `prosemirror/commands` index import
- [ ] 4.2 Add export key; ensure it reuses core paraText + `mapHexToHighlightName` / `pointsToHalfPoints`
- [ ] 4.3 React: `useDocxEditorRefApi.ts:228-381` delegates, passing `getView()` + cached resolver
- [ ] 4.4 Vue: `useFormattingActions.ts:82-213` delegates, passing `editorView.value` + `createStyleResolver`-based resolver
- [ ] 4.5 Core unit test: `applyFormatting.test.ts` — each mark branch, unresolvable paraId/search returns false without dispatch, and **resolver reconciliation** (React-cached vs Vue-rebuilt resolver produce the same applied style)
- [ ] 4.6 Verify: typecheck; core unit test; `formatting`, `colors`, `fonts`, `paragraph-styles`, `line-spacing`; `api:extract` + `check:parity-contract`; `bun changeset`

## 5. Table-resize readers/commits → core

- [ ] 5.1 Create `packages/core/src/prosemirror/tableResize.ts` with `readColumnWidths`, `readRowHeight`, `readLastColumnWidth`, `commitColumnResize`, `commitRowResize`, `commitRightEdgeResize` + `TWIPS_PER_PIXEL` / `MIN_CELL_WIDTH_TWIPS` / `MIN_ROW_HEIGHT_TWIPS`; add export key
- [ ] 5.2 React: `internals/tableResize.ts` re-exports from core; `useTableResizeState.ts` FSM unchanged (still resolves body-vs-HF view, preserves `resizeTargetViewRef`)
- [ ] 5.3 Vue: delete inline readers/commits in `useTableResize.ts:226-399`, call core; FSM/`install()` unchanged
- [ ] 5.4 Core unit test: `tableResize.test.ts` — readers, min-size clamps (`MIN_CELL_WIDTH_TWIPS`/`MIN_ROW_HEIGHT_TWIPS`), column/row/right-edge commit transaction output
- [ ] 5.5 Verify: typecheck; core unit test; table specs; manual column/row/right-edge resize in body + header/footer in both demos; `bun changeset`

## 6. Image PM-commit → core

- [ ] 6.1 Create `packages/core/src/prosemirror/imageCommit.ts`: `commitImageResize(view,pmPos,w,h)` + `commitImageDragMove(view,opts)` (float EMU branch + inline delete/insert branch); add export key
- [ ] 6.2 React: `useImageInteractions.ts:44-149` calls core; gesture tracking + hit-testing stay
- [ ] 6.3 Vue: `ImageSelectionOverlay.vue:574-651` calls core; gesture tracking + `resolveDomPosition` hit-testing stay
- [ ] 6.4 Before deleting either copy, verify the float-branch EMU offset math matches between adapters; capture it in `imageCommit.test.ts` (float `setNodeMarkup` position output + inline delete/insert positions)
- [ ] 6.5 Verify: typecheck; core unit test; image specs; manual float drag, inline drag, resize in both demos; `bun changeset`

## 7. Drag auto-scroll math → core + wire Vue

- [ ] 7.1 Lift scroll-delta math + `EDGE_ZONE`/`MAX_SPEED` to a core helper (`computeAutoScrollDelta(rect,mouse)`), co-located with `findVerticalScrollParent`; add export key
- [ ] 7.2 React: `hooks/useDragAutoScroll.ts` uses core delta math (shell unchanged)
- [ ] 7.3 Vue: `composables/useDragAutoScroll.ts` uses core delta math AND wire it into the Vue pointer handler (currently never called)
- [ ] 7.4 Core unit test: `autoScroll.test.ts` — zero delta outside edge zone, non-linear speed curve inside zone, top vs bottom edge; add an **automated Vue spec** asserting drag-to-edge scrolls the container
- [ ] 7.5 Verify: typecheck; core unit test; `cursor-navigation-autoscroll` (React) + new Vue spec; `bun changeset`

## 8. Comment / proposeChange transaction builders → core

- [ ] 8.1 Create `createCommentIdAllocator()` in core returning `{ next(), seedAbove(maxId) }` — **instance-scoped**, not module-global (replaces React's `let nextCommentId` and Vue's `Math.max(...)+1`); preserves monotonic-no-reuse semantics
- [ ] 8.2 Create `packages/core/src/prosemirror/commentOps.ts`: `createCommentTr`, `replyTr`, `proposeChangeTr` (mark application, range resolution, overlap rejection), taking the allocator as a param; add export key(s)
- [ ] 8.3 Each adapter instantiates one allocator per editor instance and seeds it on document load (`seedAbove(maxId)`); collapse duplicated `commentFactories.ts` (React + Vue) into core
- [ ] 8.4 React: `useDocxEditorRefApi.ts:109-226` + `proposeChange` call core builders with the instance allocator; state/setComments wiring stays
- [ ] 8.5 Vue: `useCommentManagement.ts:44-163` call core builders with the instance allocator; emit/subscriber wiring stays
- [ ] 8.6 Core unit test: `commentOps.test.ts` — allocator is monotonic + no reuse after delete + per-instance isolation (two allocators don't share state); overlap rejection in `proposeChangeTr`
- [ ] 8.7 Add an **automated Vue spec**: add → delete → add a comment/tracked-change yields no id collision, and the change round-trips (no duplicate OOXML id)
- [ ] 8.8 Verify: typecheck; core + Vue tests; `comments-sidebar` + tracked-changes specs in both adapters; `api:extract` + `check:parity-contract`; `bun changeset` (note as fix for Vue id collision)

## 9. Wrap-up

- [ ] 9.1 Confirm both adapters retain no duplicated copies of any lifted function (grep the twins)
- [ ] 9.2 Run `bun run typecheck` + a broad Playwright pass before final validation
- [ ] 9.3 Update issue #696 with Tier 1 completion; note remaining Tier 2/3 scope
