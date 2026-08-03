# Tasks

## 1. Document search (engine)

- [x] 1.1 `packages/core/src/binding/document-search.ts`: body-story walk, non-overlapping `indexOf` scan, length-preserving case fold, whole-word test on single characters, bounded query and match count, bounded match text and context.
- [x] 1.2 `TreeDocxSession.findText`, memoized one deep on `(revision, question)`.
- [x] 1.3 Unstub `Editor.findMatches` and `Editor.selectMatch` in `editor/docx-editor.ts`; `selectMatch` selects the span and reveals its page, and refuses a malformed match.
- [x] 1.4 `TextMatch` gains optional `contextBefore` / `contextAfter` in `contracts/editor.ts`.
- [x] 1.5 Tests: `binding/__tests__/document-search.test.ts` (order, offsets, run addressing through a hyperlink, tabs, table exclusion, case, whole word, context, caps, regex-shaped queries, offset-preserving fold) and facade tests for find/select.

## 2. Navigation pane (React)

- [x] 2.1 `navigation-geometry.ts`: `navigationShift` for both centring regimes, plus the reservation constants.
- [x] 2.2 `navigation-layout.ts`: the store `DocxEditorRoot` publishes, so the pane and the viewport (siblings, not ancestor and descendant) share one channel without re-rendering the subtree on resize.
- [x] 2.3 `useNavigationPane` — open/tab state (controlled or not), viewport measurement, published shift.
- [x] 2.4 `useDocumentOutline` — headings, nesting depth relative to the shallowest present, jump that moves the caret and reveals.
- [x] 2.5 `useDocumentSearch` — debounced query, per-tick re-derivation with reference-equality bail-out, wrapping next/previous, options.
- [x] 2.6 `DocxEditorNavigation` + parts, with the default composition and the statics.
- [x] 2.7 `DocxEditorViewport` registers itself and applies the shift; `DocxEditorHorizontalRuler` follows it.
- [x] 2.8 `DocxEditor` gains the `navigation` prop, the workspace row, and the `Navigation` static.
- [x] 2.9 Pane chrome in `packages/core/src/styles/editor.css`, on `--doc-*` tokens, with a reduced-motion branch. Adapter CSS stays thin.
- [x] 2.10 `navigation.*` i18n keys, ICU plural for the result total.
- [x] 2.11 Tests: `packages/react/test/navigation-pane.test.tsx` — the shift rule across both regimes and a width sweep, plus composition, inert-when-closed, controlled state, and the misplaced-part throw.

## 3. Demo and repo artifacts

- [x] 3.1 `examples/vite` composes `DocxEditor.Navigation`; the outline overlay markup and the fixed 288px shift CSS are deleted.
- [x] 3.2 New React-only exports recorded in `notes/intentional-export-divergence.md`.
- [x] 3.3 API snapshot refreshed; changeset added.

## 4. Verification

- [x] 4.1 Browser: at 1728px the page's left edge is 456px with the pane closed AND open — the document does not move.
- [x] 4.2 Browser: at 1200px the pane publishes 272px and the page lands at 328px, clearing the panel's 312px right edge.
- [x] 4.3 Browser: Find over the element-test fixture returns results with context, the readout goes total → position, and selecting a result scrolls the document to the match and selects it.
- [x] 4.4 Empirical check that padding P moves the centred page by P/2 and pins at P past the crossover — the assumption the shift rule is built on.

## 5. Follow-ups (not this change)

- [ ] 5.1 The Replace tab, over `replaceMatch` / `replaceAllMatches` (back-to-front application, one undo step).
- [ ] 5.2 Highlight-all-matches through the `decoration` display item.
- [ ] 5.3 Search inside table cells, once `TextMatch.paragraphIndex` is redefined to admit them.
- [ ] 5.4 The headings list following the caret, once the engine can answer "which heading contains this position" without a document walk.
- [ ] 5.5 The Vue twin, with the composable layer.
