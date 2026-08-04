## Why

The outline panel answers one question — "what are this document's headings?" — and answers it in a panel that pushes the document sideways every time it opens.

Both halves are wrong.

**Find does not exist.** `Editor.findMatches` returns `[]` and `Editor.selectMatch` returns `{ ok: false, code: 'unsupported' }` in `packages/core/src/editor/docx-editor.ts`. The contract has carried `TextMatch`, `findMatches`, `selectMatch`, `replaceMatch` and `replaceAllMatches` since the editor facade was written; nothing implements them. A user with a 200-page contract has no way to reach the word they are looking for except scrolling.

**The panel moves the document for no reason.** The demo shifts the page column right by a fixed 288px whenever the outline opens (`.demo-viewport--outline` in `examples/vite/src/styles.css`). On a 1728px viewport with a Letter page there is already 456px of empty gutter on each side — more than the panel needs — so the shift buys nothing and costs the reader their place on the line they were reading. The rule should be geometric, not constant.

The engine already has the pieces. `getOutline()` is a real per-revision derivation over the canonical trees (`binding/document-outline.ts`), `scrollToBlock` reveals a page through layout rather than the DOM, and `paragraphTextOf` gives bounded paragraph text in the same offset vocabulary the surface selection uses. What is missing is a search derivation next to the outline one, and a panel that knows how much room it actually needs.

## What Changes

**Document search (engine)**

- Add `packages/core/src/binding/document-search.ts`, a sibling of `document-outline.ts` under the same discipline: reads the canonical tree, bounds every string that leaves it, and scans with `indexOf` only. Both the haystack (file content) and the needle (host input) are attacker-influenced, so no pattern is ever compiled from either; the single regex in the module tests ONE character at a time for the whole-word rule.
- Matches are non-overlapping (searching `aa` in `aaaa` finds two, not three), case-insensitive by default, and `wholeWord` on request. Offsets are `paragraphTextOf`'s vocabulary, so a match can be handed straight to `setSelection`.
- Case folding is LENGTH-PRESERVING. `toLowerCase` can expand (U+0130 becomes two code units), and an expansion mid-paragraph would slide every offset after it — the match would be reported where the editor then selects the wrong text.
- Bounded: queries over 256 characters are refused, the scan stops at 2000 matches and says so. A one-character query against a long document must not allocate an entry per character.
- `TreeDocxSession` gains `findText`, memoized one deep on `(revision, question)` — a find panel asks the same question on every tick.
- `Editor.findMatches` and `Editor.selectMatch` stop being stubs. `selectMatch` selects the match AND reveals its page: moving the caret does not move the viewport, and a match twenty pages down was otherwise selected where nobody could see it.

**Contract (additive)**

- `TextMatch` gains optional `contextBefore` / `contextAfter`. A result row shows the match in its sentence, and nothing else in the contract can reach paragraph text — without these a caller would have to re-read the document to render one row.

**Navigation pane (React)**

- `DocxEditor.Navigation`: a compound over the left gutter with Headings and Find tabs, parts as statics (`.Header`, `.Close`, `.Title`, `.Tabs`, `.Tab`, `.Headings`, `.Find`, `.Toggle`), and three hooks underneath — `useNavigationPane`, `useDocumentOutline`, `useDocumentSearch`.
- Mounted by default in `<DocxEditor>`; `navigation={false}` removes it. The existing `DocxEditor.DocumentOutline` part is unchanged, so hosts using it keep what they have.
- The pane FLOATS over the gutter and stays mounted when closed, so a typed query and a scrolled list survive a close and reopen.

**The displacement rule**

- An open pane publishes a shift only when the gutter is too narrow to hold it, and only as much as it needs. The page stack centres itself, so a viewport padding P moves the page by P/2 until the padded box is narrower than a page, after which the page pins at P. `navigationShift` solves both regimes exactly and is exported so a host can reuse or test it.
- `DocxEditor.Viewport` and `DocxEditor.HorizontalRuler` consume the published shift, so the ruler stays over the page it measures. The demo's fixed 288px shift is deleted.

## Impact

- `packages/core`: new `binding/document-search.ts`; `binding/tree-session.ts` gains `findText`; `editor/docx-editor.ts` unstubs two members; `contracts/editor.ts` gains two optional fields; `styles/editor.css` gains the pane's chrome.
- `packages/react`: new `editor/navigation/`; `DocxEditorRoot` publishes a layout store; `DocxEditorViewport` registers itself and applies the shift; `DocxEditorRulers` follows it; `DocxEditor` gains the `navigation` prop and the `Navigation` static.
- `packages/i18n`: `navigation.*` keys. `documentOutline.*` stays.
- `examples/vite`: composes `DocxEditor.Navigation`; its outline overlay and shift CSS are removed.
- React-first, like the rest of the provider/hooks layer. The Vue twin lands with the composable layer.

## Not in this change

Named here so the gaps are a decision rather than an omission:

- **The Replace tab.** Replacing is a write with undo semantics, and `replaceAllMatches` has to apply back-to-front because each replacement shifts the offsets after it. That belongs with its own tests, not bolted onto a read.
- **Highlight-all-matches in the document.** Word tints every match; this ships the active one only, through the existing selection band. Painting the rest needs a transient highlight set threaded through layout to the `decoration` display item — a real change to the paint path, not a panel feature.
- **Table-cell text.** The search walks body-story paragraphs, matching the contract's own definition of `TextMatch.paragraphIndex` ("ordinal among PARAGRAPHS in the body, skipping tables"). Widening it means redefining that ordinal first.
- **Following the caret in the headings list.** The list marks the heading the PANE navigated to, not the one the caret is in. Tracking the caret needs either a new engine derivation or a document walk on every selection change; the honest cheap answer is the one shipped, and the field is named for what it does.
