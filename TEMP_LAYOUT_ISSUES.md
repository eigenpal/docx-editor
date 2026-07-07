# Temporary Layout Issue Tracker

Internal working notes for the current client DOCX investigation. Remove before merge unless we decide to keep a cleaned-up version elsewhere.

- [x] Section 17 heading inherits stale wrap from prior floating table
  - Symptom: `17. Unicode & International Text` rendered in a narrow right-side strip in docx-editor, while Word rendered it full-width and left-aligned.
  - Cause: text-relative floating table wrap zones stayed active after layout moved beyond the float's page-local influence.
  - Fix: added page-local fallback paragraph measures and swap to them once pagination moves to a later page or below the floating table's painted bottom.
  - Verification: focused float measurement regression, continuous-section geometry tests, full typecheck/API check through commit hook, and visual verification on page 19.

- [x] First page header should be absent
  - Word: first page has no visible header.
  - docx-editor: first page shows the `Element Test Summary / FINAL SECTION` header.
  - DOCX evidence: section 1 has no `w:headerReference` entries.
  - Cause: React/Vue resolved one header/footer set for the whole rendered document, and React resolved from `finalSectionProperties ?? initialSectionProperties`; this applied section 5's final header (`header4.xml`) to page 1.
  - Fix: tag each laid-out page with section metadata and let the painter select header/footer content from the page's own section.
  - Verification: local demo direct DOM check shows page 1 header text is empty.

- [x] First page footer should be absent
  - Word: first page has no visible page-number footer.
  - docx-editor: first page shows a page footer.
  - DOCX evidence: section 1 has no `w:footerReference` entries.
  - Cause: same global HF resolution as first-page header; section 5's final footer (`footer4.xml`) was available as the document-level/default footer and painted on page 1.
  - Fix: same per-page/per-section header/footer selection as above.
  - Verification: local demo direct DOM check shows page 1 footer text is empty.

- [x] Second page header does not match Word
  - Word: page 2 table-of-contents page header shows `Comprehensive Word Element Test v2` and `CONFIDENTIAL`.
  - docx-editor: page 2 header shows `Element Test Summary / FINAL SECTION`.
  - DOCX evidence: section 2 has default `headerReference rId6 -> header1.xml` and `footerReference rId7 -> footer1.xml`; `header1.xml` contains `Comprehensive Word Element Test v2` and `CONFIDENTIAL`.
  - Cause: page 2 belongs to section 2, but the painter received section 5's final header (`header4.xml`) because layout/render options were not resolved per page section.
  - Fix: compute header/footer render content for every document section and select section-local first/default variants while painting each page.
  - Verification: local demo direct DOM check shows page 2 header text is `Comprehensive Word Element Test v2	CONFIDENTIAL`.

- [x] TOC section header right tab should align `CONFIDENTIAL` to the right
  - Word: `CONFIDENTIAL` sits near the right side of the header line.
  - docx-editor: `CONFIDENTIAL` rendered immediately after a small literal-tab gap.
  - DOCX evidence: `header1.xml` uses a right tab stop at `w:pos="9026"` and the imported text also contains a literal tab character.
  - Cause: literal tab characters inside `w:t` became plain text spans, bypassing the existing tab-stop renderer.
  - Fix: split literal `\t` text into ProseMirror tab nodes during Document-to-ProseMirror conversion.
  - Verification: Cursor browser DOM check shows a `layout-run-tab` span between the title and `CONFIDENTIAL`; `CONFIDENTIAL` now renders at x=608-698 instead of x=308-398.

- [x] Footer should show a line above `QA Automation Department`
  - Word: section footer has a thin horizontal line above the footer text.
  - docx-editor: visually appeared to miss the line in the side-by-side screenshot.
  - DOCX evidence: `footer1.xml` has paragraph top border `w:pBdr/w:top` with color `CCCCCC`, size `2`, and space `1`.
  - Reopened: DOM had a paragraph border, but it is not visibly showing; likely clipped by the footer container or painted partly outside the visible footer band.
  - Cause: HF visual bounds do not include paragraph border space; the footer paragraph border starts 1.33px above the footer container while the container has `overflow: hidden`, so the line is clipped.
  - Fix: include paragraph border spacing in HF visual bounds so the footer container expands upward enough to keep the border inside the unclipped band.
  - Verification: focused HF visual-bounds regression; Cursor browser DOM check shows footer border top is inside the footer container (`topDelta: 0`) with `border-top: 1px solid rgb(204, 204, 204)`; full page 3 screenshot captured.

- [x] Page 3 has too much gap above `1. Text Formatting & Typography`
  - Word: the heading starts at the top body position under the header.
  - docx-editor: page 3 started with a blank paragraph, pushing the heading lower.
  - DOCX evidence: body paragraph before the heading contains only a hard page break (`w:br w:type="page"`).
  - Reopened: the blank paragraph was removed, but the remaining top offset above the first heading is still too large compared with Word.
  - Cause: page-top layout still applies style-inherited `Heading1` `spaceBefore=360` twips (24px); Word suppresses inherited paragraph space-before at a fresh page top while preserving explicitly authored spacing.
  - Fix: suppress non-explicit paragraph `spaceBefore` when placing the first body fragment on a fresh page; keep explicit paragraph spacing intact.
  - Verification: focused page-top spacing regression; Cursor browser DOM check shows page 3 heading moved from y=120 to y=96 and its fragment now has `top: 0px` within the content area; page 3 screenshot captured.

- [x] Wavy and thick underline styles render like regular underline
  - Word: `Wavy underline` uses a wavy underline and `thick underline` uses a heavier underline.
  - docx-editor: both appear as ordinary straight/thin underlines in the page 3 text formatting section.
  - Screenshot evidence: side-by-side crop shows section `1.2 Advanced Text Formatting`; Word differentiates wavy/thick underline, docx-editor does not.
  - DOCX/code evidence: `word/document.xml` has `w:u w:val="wave" w:color="FF0000"` for `Wavy underline` and `w:u w:val="thick"` for `thick underline`; parser preserves these underline styles into PM marks/layout runs.
  - Cause: visible painter passed OOXML underline style values directly to CSS (`wave` is invalid CSS; `thick` needs `text-decoration-thickness`), and the hidden PM underline mark had the same incomplete mapping.
  - Fix: added shared OOXML-to-CSS underline mapping and wired it into the visible painter, hidden PM underline mark, and generic format-to-style helper.
  - Verification: focused underline mapping unit test; Cursor browser DOM check shows `Wavy underline` has `text-decoration-style: wavy` and red decoration color, while `thick underline` has `text-decoration-thickness: 2px`; page 3 screenshot confirms the styling visually.

- [x] Section 5.3 double table borders render as single borders
  - Word: cells in `5.3 Mixed Border Styles` show true double borders, e.g. the `Double blue + dashed right` cell has a double blue border.
  - docx-editor: the same borders appear as ordinary single-line borders.
  - Screenshot evidence: side-by-side crop shows Word with double border strokes while docx-editor paints single strokes.
  - DOCX evidence: the `Double blue + dashed right` cell uses `w:top/left/bottom w:val="double" w:sz="3"` and the `Triple purple bottom + green` cell uses `w:bottom w:val="triple" w:sz="3"`.
  - Cause: table cell borders preserve the `double` CSS style, but OOXML `w:sz="3"` converts to `1px`; browsers render `1px double` as a single visible stroke. Page borders already clamp `double` widths to at least `3px`, but table/cut borders did not.
  - Fix: clamp CSS double table/cut borders to at least `3px`, matching the existing page-border behavior so both strokes are visible.
  - Verification: focused table border helper regression; Cursor browser DOM check shows `Double blue + dashed right` now has `3px double rgb(46, 117, 182)` on the top/left/bottom borders.

- [x] Section 6.2 triple-nested table geometry differs from Word
  - Word: nested table stack appears compact; the innermost yellow cell spans less width and the outer table height is shorter.
  - docx-editor: nested table stack appears taller/wider, with more whitespace and a wider innermost second cell.
  - Screenshot evidence: side-by-side crop of `6.2 Triple-Nested Table (3 Levels Deep)` shows docx-editor on the left and Word on the right.
  - DOCX evidence: the outer and middle table cells contain a normal label paragraph, then a nested `w:tbl`, then Word's required trailing empty `w:p`.
  - Cause: docx-editor rendered those trailing empty paragraphs after nested tables as real line-height inside table cells, adding phantom bottom space. Word treats them as structural anchors with zero visible height.
  - Fix: mark empty paragraphs immediately after nested tables in table cells with `suppressEmptyParagraphHeight`, reusing the existing zero-height paragraph measurement path.
  - Verification: focused nested-table conversion regression; Cursor browser DOM check shows the outer table height dropped from 121px to 87px and the middle table from 73px to 57px after suppressing the structural empty paragraphs; section 6.2 screenshot captured.

- [x] Section 7 commented text range lacks visible highlight
  - Word: commented text ranges show a visible comment marker/highlight cue around the referenced text.
  - docx-editor: `text with a QA review comment` does not have an obvious visible cue beyond sidebar cards.
  - Screenshot evidence: side-by-side crop of section `7. Comments & Annotations`.
  - Cause: comment ranges were painted, but the default cue was too subtle (`rgba(255, 212, 0, 0.15)` plus a faint 1px underline), so the range was easy to miss at zoomed-out sizes.
  - Fix: strengthen default comment-range highlighting in the visible painter and hidden PM DOM to a brighter yellow fill and 2px amber underline.
  - Verification: Cursor browser DOM check shows `text with a QA review comment` has `background-color: rgba(255, 212, 0, 0.3)` and `border-bottom: 2px solid rgba(255, 184, 0, 0.75)`; section 7 screenshot captured.
  - Reopened: user verification shows the first `text with a QA review comment` range still has no visible highlight while the other section 7 comments do.
  - Reopened cause: visible DOM had a plain `.layout-run` for comment id `0`, while the hidden PM DOM had `.docx-comment`; `toFlowBlocks/runs.ts` dropped `commentId=0` because it used `if (commentId)` before copying comment marks into layout runs.
  - Reopened fix: accept finite numeric comment ids, including `0`, when extracting comment marks for visible flow runs.
  - Reopened verification: focused bridge regression; Cursor browser DOM check shows the visible `.layout-run` for `text with a QA review comment` now has `data-comment-id="0"`, `background-color: rgba(255, 212, 0, 0.3)`, and `border-bottom: 2px solid rgba(255, 184, 0, 0.75)`.

- [x] Section 7 comment replies are missing from sidebar
  - Word: `QA Reviewer` has a reply/comment thread related to `Dev Lead`.
  - docx-editor: sidebar shows top-level cards but the QA Reviewer reply to Dev Lead is not visible.
  - Screenshot evidence: side-by-side crop of section `7. Comments & Annotations`.
  - DOCX evidence: `comments.xml` contains comment id `3` by `QA Reviewer` with text `Reply: I’ve added CJK and RTL examples.`; `document.xml` nests comment range `3` inside comment range `2`.
  - Cause: the document omits explicit `commentsExtended.xml`/`parentId` reply metadata, and PM conversion only marks the first active overlapping comment, so nested comment id `3` had no sidebar anchor and was not threaded under id `2`.
  - Fix: infer reply threading from nested comment ranges during parse when explicit parent metadata is missing, so id `3` renders as a reply under comment id `2`.
  - Verification: focused nested-range threading regression; Cursor browser DOM check shows the Dev Lead card includes QA Reviewer reply text `Reply: I’ve added CJK and RTL examples.`

- [x] Comment sidebar cards should scale with document zoom
  - Word: when zoomed out, comment cards visually scale down with the page.
  - docx-editor: comment cards remain large while the document page zooms out, creating mismatched proportions and spacing.
  - Screenshot evidence: side-by-side crop of section `7. Comments & Annotations` at zoomed-out view.
  - Cause: sidebar anchors moved with zoom, but card chrome stayed at fixed pixel size and collision avoidance reserved unscaled card heights.
  - Fix: scale sidebar card slots with the editor zoom and reserve scaled card heights/gaps in collision layout; mirror behavior in React and Vue.
  - Verification: focused sidebar collision regression; Cursor browser at 50% zoom shows comment card slots use `scale(0.5)` and card boxes shrink from 340px to 170px wide; section 7 screenshot captured.

- [x] Section 8 inline endnote references render as `1`, `2` instead of `i`, `ii`
  - Word: inline endnote references in section `8.2 Endnotes` use roman numerals `i`, `ii`.
  - docx-editor: inline endnote references render as decimal `1`, `2`.
  - Screenshot evidence: side-by-side crop of section `8. Footnotes & Endnotes`.
  - Cause: `toProseDoc` rendered endnote references with the raw note id text (`1`, `2`) instead of applying the document/section endnote numbering format; footnotes happened to match because their default format is decimal.
  - Fix: format displayed note-reference text through the parsed note numbering properties while preserving the original footnote/endnote mark id for round-trip.
  - Verification: focused `toProseDoc` regression; Cursor browser page 10 shows `First endnote referencei and second endnoteii`.

- [x] Endnotes do not render at the end of the document
  - Word: endnote text appears at the end of the document after the final content.
  - docx-editor: endnote references appear inline, but the endnote bodies are missing at the document end.
  - Screenshot evidence: side-by-side crop of final page/endnote area.
  - Cause: endnotes were parsed and preserved for save, but the shared layout compute pass only collected/rendered footnotes; endnote bodies were never converted into visible layout blocks.
  - Fix: collect endnote references from visible flow blocks and append the referenced endnote bodies as ephemeral document-end FlowBlocks before measurement/layout.
  - Verification: focused layout-bridge regression; Cursor browser page 25 shows `i Endnote 1: This reference appears at the end of the document section...` and `ii Endnote 2: Additional bibliography reference...`.

- [x] Endnotes should have a separator line above them
  - Word: a horizontal line appears above the endnote list on the final page.
  - docx-editor: endnote bodies render, but there is no separator line above them.
  - Screenshot evidence: side-by-side crop of final page/endnote area.
  - DOCX evidence: `endnotes.xml` contains `w:endnote w:type="separator"` with a `w:separator` run before the normal endnotes.
  - Cause: endnote bodies were appended as ordinary document-end FlowBlocks, but the separator note was still treated as preservation-only metadata and never converted into visible layout.
  - Fix: synthesize a separator paragraph before the first appended endnote body when the document has referenced endnotes.
  - Verification: focused endnote layout regression; Cursor browser DOM on page 25 shows an empty separator paragraph before `Endnote 1` with `border-top: 1px solid rgb(0, 0, 0)`.
  - Reopened: the separator line renders full width, but Word shows the separator only on the left side and much shorter.
  - Reopened cause: the synthesized separator paragraph used a full-width paragraph border; Word's note separator is a short left-aligned rule.
  - Reopened fix: size the synthetic endnote separator to one-third of the final content width by applying a right indent to the separator paragraph.
  - Reopened verification: Cursor browser DOM on page 25 shows separator width `208px` against content width `624px` (`ratio: 0.3333`) with `leftDelta: 0`.

- [x] Final `END OF COMPREHENSIVE TEST DOCUMENT v2` divider should be a double line
  - Word: the line above the final end-of-document heading is a double horizontal rule.
  - docx-editor: the divider appears as a single line.
  - Screenshot evidence: side-by-side crop of final page/endnote area.
  - DOCX evidence: the final heading paragraph has `w:pBdr/w:top w:val="double" w:color="1B3A5C" w:sz="3" w:space="8"`.
  - Cause: paragraph borders preserved the `double` CSS style, but OOXML `w:sz="3"` converts to `1px`; browsers render `1px double` as a single visible stroke. Table/page borders already clamp double borders, but paragraph borders did not.
  - Fix: clamp CSS double paragraph borders to at least `3px`, matching page/table border behavior.
  - Verification: focused paragraph-border regression; Cursor browser DOM on page 25 shows the final heading border as `3px double rgb(27, 58, 92)`.

- [x] Zoomed scrolling/page-number rail is out of sync and can leave bottom gap
  - User report: when zoom is not 100%, the page numbering next to the scrollbar is out of sync with the visible pages.
  - User report: when zooming out, the scrollable area keeps too much height and leaves a huge empty space at the bottom.
  - User report: when zooming in, the page numbering is still out of sync, but scrolling reaches the end of the last page without a bottom gap.
  - Cause: the page indicator compared raw scroll coordinates against unscaled page geometry, while the visual page stack was CSS-scaled. React also transformed the scroll spacer itself; at zoom-out, the unscaled child overflow still contributed the old 100% document height to the scroll container.
  - Fix: added shared zoom-aware scroll geometry helpers, used them in React and Vue page-indicator logic, and changed the zoom spacer to reserve the scaled visual height while clipping the transformed child overflow.
  - Verification: focused scroll geometry regression; `bun run typecheck`; Cursor browser on localhost shows 50% scroll height reduced to the scaled page stack and page pill `1 of 25` / `13 of 25` / `25 of 25` at top/middle/bottom; 150% shows the same aligned page-pill behavior.

- [x] Scrolling should leave breathing room below the final page
  - User report: after the zoomed scrolling fix, scrolling stops exactly at the end of the last page.
  - Cause: the zoom scroll spacer was intentionally clipped to the exact scaled visual document height, leaving no scrollable slack below the final page.
  - Fix: add a shared 96px bottom scroll margin to the visual scroll-height helper and use it in React/Vue spacer sizing.
  - Verification: focused scroll geometry regression; `bun run typecheck`; Cursor browser at bottom scroll shows about `96px` of breathing room at 50% zoom and the page indicator still caps to the final page.

- [x] Final long summary table wraps too early and splits through a row
  - User report: on the last two pages, Word wraps the long table after row 29, but docx-editor wraps in the middle of row 28.
  - User report: docx-editor rows appear slightly taller than Word, and the table pagination breaks through the row instead of between rows.
  - Screenshot evidence: side-by-side crop comparing final table page break.
  - Cause: table row measurement used a non-collapsed vertical border budget: every row counted both top and bottom borders, while the painter's collapsed model only paints top borders at table/fragment starts and bottom borders for shared row edges. The layout bridge also rounded OOXML hairline borders (`w:sz="1"`) up to `1px` for geometry. Across the 29-row page this made rows slightly too tall, so the paginator reached the page bottom during row 28/29. The row-break engine then sliced any row when one line fit in the remaining space, even if the whole row would fit on a fresh page.
  - Fix: measure collapsed table borders once per shared row edge, preserve subpixel OOXML border widths for layout geometry (while the painter still clamps double borders for visibility), and move rows whole to the next page when the remaining row fits on a fresh page/column.
  - Verification: focused `bun test packages/core/src/layout-engine/integration/table-row-break.test.ts packages/core/src/layout-bridge/__tests__/measureTable-vmerge-height.test.ts packages/core/src/layout-bridge/__tests__/borderConversion.test.ts`; Playwright local probe on `http://localhost:5175/?e2e=1&empty=1` shows the final table page 24 `lastBodyRow: 29` and page 25 `firstBodyRow: 30`; Cursor browser DOM verification on the same localhost server showed the same row boundary.

- [x] Section 21 content controls do not render as controls inside table cells
  - User report: content-control fields render correctly outside the table, but the same fields inside the Section 21 table render as a normal empty table.
  - Reopened: table-cell values now render, but they render as normal placeholder text like `Enter project name`; they still do not look/behave like the content controls above the table.
  - Screenshot evidence: side-by-side crop of `21. Content Controls (SDT Elements)`.
  - Cause: table-cell parsing, PM conversion, and table-cell flow conversion only handled direct paragraphs/tables. A block-level `w:sdt` directly under `w:tc` was dropped at parse before the fix, and the subsequent PM/layout paths also lacked `blockSdt` support inside table cells, so the visible painter received empty value cells.
  - Fix: allow `TableCell.content` to carry `BlockContent`, preserve/serialize block SDTs in DOCX table cells, allow `blockSdt` in PM table cell/header schemas, round-trip cell SDTs through PM, and flatten cell SDTs into tagged flow blocks for visible table rendering.
  - Verification: focused SDT parser/serializer + PM/layout regression tests; Cursor browser on localhost with a generated Section-21-shaped DOCX shows visible cells `Project Name | Q4 Migration` and `Team Lead | Ada Lovelace`, with outside control `Outside Value` still rendered.
  - Reopened cause: the prior fix preserved table-cell `blockSdt` wrappers into PM/layout and tagged the inner cell `FlowBlock`s with `sdtGroups`, but visible SDT chrome only rendered from top-level page fragments in `renderPage.ts`. Table-cell paragraphs are synthetic fragments rendered inside `renderTable.ts`, so the painter showed the preserved text without stamping `data-sdt-*` or drawing the `.layout-block-sdt-box` label/widget overlay.
  - Reopened fix: factor the SDT boundary renderer so table-cell content can draw the same boxes/widgets from local block extents, and stamp rendered cell paragraphs/nested tables with the innermost SDT metadata.
  - Reopened verification: focused SDT conversion + painter regressions pass; Cursor browser on `localhost:5173/?e2e=1&empty=1` with an injected one-cell table containing a `dropDownList` `blockSdt` shows `.layout-table-cell-content .layout-block-sdt-box[data-sdt-tag="project-name"][data-sdt-type="dropDownList"]`, label `Project Name`, a `.layout-sdt-widget[data-sdt-widget="dropdown"]`, and the cell paragraph stamped with `data-sdt-tag="project-name"`.

- [x] Section 19 column breaks and separator line render incorrectly
  - User report: column breaks are not working in `19. Multi-Column Layout`.
  - User report: the column separator line renders full height, but Word shows it only spanning the used column content height.
  - Screenshot evidence: side-by-side crop of `19. Multi-Column Layout`.
  - Cause: DOCX parsing preserved `<w:br w:type="column"/>`, and the layout engine already had `ColumnBreakBlock` support, but `toProseDoc` discarded non-line inline breaks because the PM schema had no column-break node. Separator rendering also always drew from the top to bottom of the content area instead of deriving the active multi-column content extents.
  - Fix: add a PM `columnBreak` block node, split imported paragraphs around hard column breaks, map it through `toFlowBlocks`/`fromProseDoc`, and size painted column separators from the used column fragment bounds.
  - Verification: focused conversion/layout and painter regressions; Cursor browser loaded a temporary DOCX through the React demo and measured `After Column Break` in the right column (`left 641.5px` vs `Before` at `305.5px`) with separator height `53.36px` against an `864px` content area.

- [x] Section 19 blank line after column break is missing
  - User report: column breaking and separator height are correct, but an empty line after the column break does not render.
  - Cause: a trailing `<w:br w:type="column"/>` leaves the paragraph mark after the break, which Word renders as an empty line in the next column; `splitParagraphByColumnBreak` dropped that trailing empty paragraph segment because it only emitted non-empty split parts.
  - Fix: preserve the trailing empty paragraph segment when a paragraph ends with a column break, so the shared PM/layout flow carries a real empty paragraph into the next column before the following text.
  - Verification: focused conversion/layout regression confirms the post-break empty paragraph survives and the following paragraph starts one line lower in the next column.

- [ ] Section 14 mathematical equations render as plain text
  - User report: equation structures such as square roots, fractions, and summation signs are not rendering correctly in `14. Mathematical Equations`.
  - Screenshot evidence: side-by-side crop of `14. Mathematical Equations`.
  - Triage decision: known deferred issue; do not implement in this pass.
  - Cause: OMML is currently preservation-only for layout. The parser recognizes `m:oMath`/`m:oMathPara` and stores raw OMML for round-trip, but the extracted display value is just recursive `m:t` text concatenation. The PM math node stores that `plainText`, and `toFlowBlocks` converts the math node into a normal italic text run (`Cambria Math`), so the painter never receives fraction/radical/n-ary structure, baselines, limits, or stacked layout boxes.
  - Fix: deferred; real fidelity needs a shared OMML math layout path: parse OMML constructs such as `m:f`, `m:rad`, `m:nary`, scripts, limits, and grouping into a math model, measure nested math boxes, and paint inline/block math with Word-like baseline and sizing behavior. A small symbol/text substitution would improve fallback text but would still misrepresent the Word layout shown in the Section 14 screenshot.
  - Verification: code inspection of `paragraphParser/content.ts`, `MathExtension.ts`, `toProseDoc/runs.ts`, `fromProseDoc/runs.ts`, and `layout-bridge/toFlowBlocks/runs.ts`; no implementation attempted because the contained fix would be incomplete.

- [x] Section headings have too little space above them
  - User report: all section headers/headings appear to have smaller gaps above them in docx-editor than in Word.
  - Screenshot evidence: side-by-side crop around `21. Content Controls (SDT Elements)`.
  - Cause: the page-top spacing fix suppressed style-inherited `spaceBefore` on every fresh page. Word suppresses it for the first document page and standalone hard page-break paragraphs, but preserves it when a heading starts a new page because of a section break or paragraph-level `pageBreakBefore`; those section-start headings lost their 480-twip `Heading1` gap.
  - Fix: track whether a fresh page should suppress inherited paragraph spacing, set it only for the initial page and standalone hard page-break blocks, and leave section/pageBreakBefore starts to apply their inherited heading `spaceBefore`.
  - Verification: focused layout regression covers standalone page-break suppression plus preserved spacing after next-page section breaks and `pageBreakBefore` paragraphs; adjacent section-break layout tests pass; local Chromium check on a synthetic section-start Heading1 DOCX shows the heading on page 2 with `top: 32px` / `gapPx: 32`, matching `w:before="480"`.
- [x] Section 13 shaded callout boxes have wrong fill/padding and hidden text
  - User report: shaded boxes in `13. Borders, Shading & Callouts` do not match Word: backgrounds are not edge-to-edge inside the box and padding/spacing is wrong.
  - Reopened: after the shaded-border fix, the callout text is invisible inside the shaded boxes.
  - Screenshot evidence: side-by-side crop of `13. Borders, Shading & Callouts`.
  - Cause: paragraph border `w:space` was parsed and used to expand the absolute paragraph border overlay, but paragraph shading stayed on the unexpanded fragment box. The border padding area between the text and the border therefore remained unfilled, making the callouts look inset and too tight compared with Word.
  - Fix: paint paragraph shading on the same expanded border overlay when a shaded paragraph has borders, while keeping unbordered paragraph shading on the fragment itself.
  - Verification: focused painter regression confirms the shaded callout fill uses the expanded `layout-paragraph-border` box (`left/right/top/bottom` include border spaces) and no longer paints a separate fragment background. Browser verification of the exact Section 13 fixture was blocked because the screenshot DOCX is not present in committed fixtures; the closest React e2e spec also could not boot in the current dirty worktree due to an unrelated missing `./renderTableSdt` import in `renderTable.ts`.
  - Reopened cause: moving shaded bordered-paragraph fill onto the absolute `.layout-paragraph-border` box fixed the fill extents, but that positioned overlay had no explicit stacking order. CSS paints positioned descendants above normal in-flow line boxes, so the shaded background sat on top of the callout text.
  - Reopened fix: keep the expanded paragraph border/shading box as a lower layer (`z-index: 0`) inside an isolated paragraph stacking context, and render each paragraph line as a higher layer (`z-index: 1`) so text stays visible while fill still reaches the border edges.
  - Reopened verification: focused painter regression confirms shaded callout borders keep the expanded background box and text lines sit above it; browser verification on `/tmp/Comprehensive_Word_Element_Test.docx` shows Section 13 on page 15 with all four callout labels present, `.layout-paragraph-border` at `z-index: 0`, `.layout-line` at `z-index: 1`, `isolation: isolate`, and fill extending 11px left / 5px top beyond the paragraph content box.
- [x] Section 11 dot leaders do not render
  - User report: dot leaders in `11.2 Dot Leaders` are missing; Word shows dotted leader runs between chapter titles and right-aligned page numbers.
  - Screenshot evidence: side-by-side crop of `11. Tab Stops, Leaders & Breaks`.
  - Cause: the fixture uses OOXML absolute-position tabs (`w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"`) inside the run, not ordinary `w:tab` runs backed by paragraph `w:tabs`. The parser counted `w:ptab` as visible content but did not convert it into a tab content item, so `Chapter 1: Introduction`, the positional tab, and `1` collapsed into one text run before layout/painter could render a leader.
  - Fix: parse `w:ptab` into tab content with positional alignment/relative/leader metadata, carry it through the PM tab node and layout `TabRun`, measure/render positional tabs against the line's right margin with the shared tab-width calculator, and serialize positional tabs back as `w:ptab`.
  - Verification: focused parser/layout/tab-calculator/painter regressions pass; real `/tmp/Comprehensive_Word_Element_Test.docx` Section 11 now parses as `text | tab | page number` with `{ alignment: "right", relativeTo: "margin", leader: "dot" }`; browser verification in the React demo shows page 13 lines for all four entries with flex-anchored `.layout-run-tab` dot leaders before the page numbers (tab widths about 451-534px).

- [x] Borrow stronger header/footer architecture from PR #1055
  - User request: compare colleague PR #1055 and take the genuinely better fixes so this branch has the best of both worlds.
  - Cause: our branch solved the visible first/second page header/footer bugs, but still selected rendered HF content through section-index content arrays and global HF margin growth. PR #1055's relationship-id model is more general: pages carry effective header/footer refs, even/odd header settings come from `settings.xml`, editing routes by `rId`, and header/footer margin growth uses each section's own parts.
  - Fix: parse `w:evenAndOddHeaders`, stamp inherited `PageHeaderFooterRefs` onto section breaks and laid-out pages, select painted headers/footers by page refs plus first/even/default rules, extend margins per section's referenced HF parts, route React/Vue HF editing to the displayed `rId`, add compact section-ref and ptab round-trip regressions, and keep our existing broader visual fixes.
  - Verification: focused borrowed-PR regressions pass (`64 pass`), `bun run typecheck` passes, `bun run api:check` passes, and browser verification on `/tmp/Comprehensive_Word_Element_Test.docx` shows 25 pages with page 1 blank HF, page 2 using main header/footer parts (`rId6`/`rId7`), and page 25 using final-section parts (`rId12`/`rId13`) with no visible import error.

- [x] Section 12 checkbox controls do not render
  - User report: native checkbox controls in `12.1 Native Checkbox Controls` are missing; Word shows checked/unchecked boxes before each task line.
  - Screenshot evidence: side-by-side crop of `12. Form Elements & Checkboxes`.
  - Cause: native checkbox SDTs were parsed with `sdtType="checkbox"`, but the actual Section 12 display run is `<w:sym w:char="2612|2610" w:font="MS Gothic"/>` inside `w:sdtContent`; Document-to-PM conversion dropped `symbol` run content, so the painter only received the following task label text. Existing inline checkbox widget tests only covered fixtures where the checkbox was already a `w:t` glyph.
  - Fix: convert `symbol` run content into PM text while preserving its symbol font mark, so the shared PM-to-layout bridge can paint the glyph and attach inline checkbox widget metadata. Also synthesize a visible checkbox glyph for label-only checkbox SDTs whose state lives only in `w14:checkbox`, and keep toggling those controls from replacing their label text.
  - Verification: focused parser/PM/layout/painter regressions pass (`33 pass`); browser verification on `/tmp/Comprehensive_Word_Element_Test.docx` shows Section 12 on visible page 14 with `☒/☐` before all four native task lines, `7` checkbox glyphs across Sections 12.1/12.2, and `4` native `.layout-inline-sdt-widget` controls.
- [x] Comments and annotations should be subtler by default and clearer when active
  - User report: comment/annotation highlights are always a bright yellow background, while the border becomes slightly dimmer when highlighted.
  - Desired behavior: default comment/annotation marks should be more subtle; active/highlighted comments should become less subtle/more obvious.
  - Cause: the default painter/PM comment mark and the React/Vue expanded-sidebar-item overrides each hard-coded their own yellow fills/borders. The resting mark used a bright fill and strong underline, while the expanded override reused a similar fill and a slightly lower-alpha border, making the active state feel less emphasized than the default.
  - Fix: add shared `--doc-comment-*` tokens in the core stylesheet for subtle default and stronger active comment/annotation marks, use those tokens from the layout painter and PM comment mark, and update both React and Vue expanded-item overrides to apply the stronger active fill and border color.
  - Verification: focused painter regression covers default tokenized comment styling and resolved-comment suppression; React-only `comments-sidebar.spec.ts` focused regressions confirm resolved highlights still hide by default and reappear when the resolved thread is expanded.
