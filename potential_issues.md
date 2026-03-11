# Potential Issues from SuperDoc Issue Tracker

Analysis of [superdoc-dev/superdoc](https://github.com/superdoc-dev/superdoc/issues) issues (108 total: 22 open, 86 closed) checked against our docx-editor codebase.

Issues are categorized by relevance and severity. Each entry notes whether we likely have the same problem.

---

## HIGH PRIORITY - Rendering & Layout Bugs

### Paragraph "between" borders not rendered

- **SuperDoc:** [#2283](https://github.com/superdoc-dev/superdoc/issues/2283), [#2074](https://github.com/superdoc-dev/superdoc/issues/2074) (closed/fixed)
- **Issue:** `w:pBdr/w:between` borders (horizontal line between consecutive paragraphs sharing a border group) are parsed but silently dropped during rendering. Only `top`, `right`, `bottom`, `left` are processed.
- **Applies to us:** LIKELY. We parse paragraph borders but need to verify `between` is rendered. Check `layout-painter/renderParagraph.ts` and border handling in our parser.
- **OOXML ref:** 17.3.1.24

### Paragraph bar borders not rendered

- **SuperDoc:** [#2282](https://github.com/superdoc-dev/superdoc/issues/2282) (open)
- **Issue:** `w:pBdr/w:bar` — vertical decorative bar on left side of paragraph — is parsed but not rendered.
- **Applies to us:** LIKELY. Need to check if our border rendering handles the `bar` border type.
- **OOXML ref:** 17.3.1.4

### TOC tab leaders overlap with text and page numbers

- **SuperDoc:** [#2075](https://github.com/superdoc-dev/superdoc/issues/2075) (open)
- **Issue:** Tab leaders (dotted, dashed, solid lines) in auto-generated TOC overlap section titles and page numbers instead of being bounded between them.
- **Applies to us:** LIKELY. We support tab stops with leaders. Check `layout-painter/` tab rendering to verify leaders are properly bounded between text content and tab stop position.

### Image alignment in table-based layouts

- **SuperDoc:** [#2341](https://github.com/superdoc-dev/superdoc/issues/2341) (open)
- **Issue:** Images in table cells (grid layout) overlap each other instead of flowing into proper rows. Table-based image layouts not respected.
- **Applies to us:** POSSIBLE. We render tables with images. Worth testing with multi-image table layouts.

### Table overlaps with text content

- **SuperDoc:** [#1870](https://github.com/superdoc-dev/superdoc/issues/1870) (closed/fixed)
- **Issue:** Table content renders on top of text content. Document shows extra blank pages.
- **Applies to us:** POSSIBLE. Check our table positioning in layout-painter. Could happen with complex document layouts.

### Merged cell rendering incorrect

- **SuperDoc:** [#1077](https://github.com/superdoc-dev/superdoc/issues/1077) (closed/fixed)
- **Issue:** Merged cells in first column render correctly, but rest are incorrect.
- **Applies to us:** POSSIBLE. We support cell merging. Test with complex merge patterns beyond first column.

### Image text wrapping renders incorrectly

- **SuperDoc:** [#1342](https://github.com/superdoc-dev/superdoc/issues/1342) (closed)
- **Issue:** Floating images with text wrapping don't match Word rendering. Text doesn't flow around images properly.
- **Applies to us:** LIKELY. Our code has a TODO in `renderParagraph.ts`: "Implement measurement-time floating image support for proper text wrapping." This is a known limitation.

### Table slight indentation offset

- **SuperDoc:** [#1160](https://github.com/superdoc-dev/superdoc/issues/1160) (closed/fixed)
- **Issue:** Small extra padding on left side of tables compared to Word.
- **Applies to us:** POSSIBLE. Compare our table margin/padding calculations against Word output.

### Header/footer content clipped or misaligned

- **SuperDoc:** [#1159](https://github.com/superdoc-dev/superdoc/issues/1159) (closed/fixed), [#1343](https://github.com/superdoc-dev/superdoc/issues/1343) (open)
- **Issue:** Header images clipped/hidden under main document. Header alignment distorted.
- **Applies to us:** POSSIBLE. Check header/footer rendering in layout-painter, especially with large images that might overflow header area.

### Line between columns not rendered

- **SuperDoc:** [#2067](https://github.com/superdoc-dev/superdoc/issues/2067) (open)
- **Issue:** `w:sectPr/w:cols` with `w:sep` or `w:lineBetween` — vertical separator line between multi-column sections not rendered.
- **Applies to us:** LIKELY. We support multi-column rendering but may not render the separator line. Check section property parsing and column rendering.

---

## HIGH PRIORITY - Data Roundtrip & Export Bugs

### Highlight export uses invalid OOXML for custom colors

- **SuperDoc:** [#2124](https://github.com/superdoc-dev/superdoc/issues/2124) (closed/fixed)
- **Issue:** Custom highlight colors exported as `<w:highlight w:fill="FFEB3B">` which is invalid OOXML. Should use `<w:shd>` for non-predefined colors. Word silently ignores the invalid element.
- **Applies to us:** CHECK. Verify our highlight serialization in `src/docx/` serializer. `<w:highlight>` only accepts predefined color names; custom colors must use `<w:shd>`.

### Text color changes on save (theme color resolution)

- **SuperDoc:** [#1490](https://github.com/superdoc-dev/superdoc/issues/1490) (closed)
- **Issue:** Table header text color changes from black to white after save/download. Theme color resolution during roundtrip corrupts colors.
- **Applies to us:** POSSIBLE. Our theme color system is complex. Test roundtrip with theme-colored text in tables.

### Font family changed after export

- **SuperDoc:** [#1040](https://github.com/superdoc-dev/superdoc/issues/1040) (closed/fixed)
- **Issue:** Document with DengXian font exports as Arial. East Asian fonts not preserved during roundtrip.
- **Applies to us:** POSSIBLE. Check if our serializer preserves `w:rFonts` attributes for East Asian, Complex Script, and HAnsi font families.

### Footer corrupted after save (extra content added)

- **SuperDoc:** [#1267](https://github.com/superdoc-dev/superdoc/issues/1267) (closed)
- **Issue:** Footer gets extra words like "[dssppace]" added after save. Field codes rendered as text.
- **Applies to us:** POSSIBLE. Check our footer serialization, especially field code handling (complex fields like `{NUMPAGES}` etc.).

### Duplicate image IDs cause only last image to render

- **SuperDoc:** [#2249](https://github.com/superdoc-dev/superdoc/issues/2249) (closed/fixed)
- **Issue:** When multiple images share `id="0"` on `<pic:cNvPr>`, only last image renders in all slots. Documents from docx-templates often have this.
- **Applies to us:** POSSIBLE. Check if our image parsing deduplicates by `cNvPr` ID. Should handle non-unique IDs gracefully.

---

## MEDIUM PRIORITY - Editing Interaction Bugs

### Arrow key navigation inconsistent / no auto-scroll

- **SuperDoc:** [#2038](https://github.com/superdoc-dev/superdoc/issues/2038) (open)
- **Issue:** Arrow Down key navigation is inconsistent. No auto-scroll when cursor reaches bottom of visible area.
- **Applies to us:** LIKELY. Our custom visual line navigation (`useVisualLineNavigation`) handles arrow keys differently from native browser behavior. Auto-scroll after cursor movement needs verification.

### Text selection disappears when toolbar dropdown opens

- **SuperDoc:** [#2037](https://github.com/superdoc-dev/superdoc/issues/2037) (closed/fixed)
- **Issue:** Selected text highlight disappears when opening font dropdown.
- **Applies to us:** POSSIBLE. Our hidden ProseMirror + visible pages architecture means selection overlay is painted separately. Toolbar interactions that steal focus could affect selection rendering. Known pitfall in CLAUDE.md about PM focus stealing.

### Toolbar dropdowns don't close on blur/outside click

- **SuperDoc:** [#2169](https://github.com/superdoc-dev/superdoc/issues/2169) (closed/fixed), [#2036](https://github.com/superdoc-dev/superdoc/issues/2036) (closed/fixed)
- **Issue:** Dropdowns in toolbar (font, table options, etc.) don't close when clicking on the editor area.
- **Applies to us:** POSSIBLE. Check our dropdown/popover close-on-outside-click behavior. ProseMirror mousedown handling can interfere.

### Indenting multiple selected list items only indents first one

- **SuperDoc:** [#1175](https://github.com/superdoc-dev/superdoc/issues/1175) (closed)
- **Issue:** Selecting multiple list items and clicking indent only affects the first item.
- **Applies to us:** CHECK. Test multi-item list indent/outdent operations in our ListExtension.

### Cannot remove list styling from multiple items at once

- **SuperDoc:** [#1088](https://github.com/superdoc-dev/superdoc/issues/1088) (closed)
- **Issue:** Selecting entire list and toggling list off only removes styling from first item.
- **Applies to us:** CHECK. Test toggle-off behavior for multi-item list selections.

### Default font/size not highlighted in toolbar dropdowns

- **SuperDoc:** [#1087](https://github.com/superdoc-dev/superdoc/issues/1087) (closed)
- **Issue:** When cursor is in text with default (inherited) font/size, the toolbar dropdowns don't show the active font/size highlighted.
- **Applies to us:** POSSIBLE. Our `selectionTracker` plugin reports selection state to toolbar. Check if default/inherited styles are resolved and reported.

### Auto-scroll during drag-select doesn't work

- **SuperDoc:** [#1700](https://github.com/superdoc-dev/superdoc/issues/1700) (closed)
- **Issue:** Drag-selecting text near viewport edges doesn't auto-scroll to reveal more content.
- **Applies to us:** LIKELY. Our paginated rendering means the visible pages container handles scrolling, not native browser behavior. Auto-scroll during drag selection needs custom implementation.

### Cross-page text selection fails on split paragraphs

- **SuperDoc:** [#1699](https://github.com/superdoc-dev/superdoc/issues/1699) (closed/fixed)
- **Issue:** Click-and-drag selection works between distinct paragraphs on different pages but fails when a single paragraph spans two pages (split block).
- **Applies to us:** POSSIBLE. Our page rendering splits content across pages. Selection mapping through split blocks needs testing.

### Selected text resets after right-click (Firefox)

- **SuperDoc:** [#1764](https://github.com/superdoc-dev/superdoc/issues/1764) (closed/fixed)
- **Issue:** In Firefox, right-clicking selected text resets the selection.
- **Applies to us:** POSSIBLE. Browser-specific selection handling differences. Test in Firefox.

### Table resize is difficult/unreliable

- **SuperDoc:** [#1739](https://github.com/superdoc-dev/superdoc/issues/1739) (closed/fixed)
- **Issue:** Only the last table column can be resized. Other cell borders rarely respond to drag.
- **Applies to us:** CHECK. We have TableResize extension. Test resize behavior on non-last columns.

### List indicator misaligned in table with hanging indent

- **SuperDoc:** [#2076](https://github.com/superdoc-dev/superdoc/issues/2076) (closed/fixed)
- **Issue:** List bullet/number positioned at hanging indent instead of left margin when list is inside a table cell.
- **Applies to us:** POSSIBLE. Check list indicator positioning in table cells with hanging indent (`w:ind` with `w:hanging`).

### Added table row doesn't inherit previous row style

- **SuperDoc:** [#892](https://github.com/superdoc-dev/superdoc/issues/892) (closed)
- **Issue:** `addRowAfter()` creates row without inheriting text-align, font-size, font-family from previous row.
- **Applies to us:** CHECK. Test our add-row commands to see if formatting is inherited.

---

## MEDIUM PRIORITY - OOXML Feature Gaps

### Contextual spacing (`w:contextualSpacing`) not respected

- **SuperDoc:** [#2068](https://github.com/superdoc-dev/superdoc/issues/2068) (closed/fixed)
- **Issue:** `w:contextualSpacing` suppresses space before/after between consecutive paragraphs of same style. Not implemented.
- **Applies to us:** CHECK. We parse contextual spacing but need to verify the layout-painter applies the spacing suppression between same-style paragraphs.
- **OOXML ref:** 17.3.1.9

### Hidden list indicators (`w:vanish` on numbering) still shown

- **SuperDoc:** [#2069](https://github.com/superdoc-dev/superdoc/issues/2069) (closed/fixed)
- **Issue:** List indicators with the Hidden font property (`w:vanish` in `w:rPr` of numbering run) should not be visible.
- **Applies to us:** CHECK. Verify our list rendering respects the vanish property on numbering run properties.

### Hyperlink click on DrawingML images not supported

- **SuperDoc:** [#2065](https://github.com/superdoc-dev/superdoc/issues/2065) (open), [#2062](https://github.com/superdoc-dev/superdoc/issues/2062) (closed)
- **Issue:** Images with `a:hlinkClick` in DrawingML don't open their hyperlink on click.
- **Applies to us:** CHECK. Verify our image parser reads `a:hlinkClick` from DrawingML and the layout-painter wraps images in clickable links.

### TIFF images not rendered

- **SuperDoc:** [#2064](https://github.com/superdoc-dev/superdoc/issues/2064) (closed/fixed)
- **Issue:** TIFF format images in DOCX render as broken image icons. Browsers don't natively support TIFF.
- **Applies to us:** LIKELY. Browsers can't display TIFF natively. Would need client-side TIFF-to-PNG/JPEG conversion.

### `w:view` setting not preserved in roundtrip

- **SuperDoc:** [#2070](https://github.com/superdoc-dev/superdoc/issues/2070) (closed/fixed)
- **Issue:** `<w:view>` element in `word/settings.xml` (print, web, outline mode) lost during import/export.
- **Applies to us:** CHECK. Verify our settings.xml parser preserves `<w:view>`. Pure roundtrip fidelity issue.

### `lvlText` null crash in list numbering

- **SuperDoc:** [#1675](https://github.com/superdoc-dev/superdoc/issues/1675) (closed)
- **Issue:** Documents with incomplete/corrupted numbering definitions where `lvlText` is null cause crash on `.replace()`.
- **Applies to us:** CHECK. Verify our list numbering code handles null `lvlText` gracefully. Check `ListExtension` and numbering generation code.

### SVG element rendering

- **SuperDoc:** [#1234](https://github.com/superdoc-dev/superdoc/issues/1234) (closed)
- **Issue:** SVG images embedded in DOCX not rendered.
- **Applies to us:** CHECK. Verify our image rendering supports SVG content type from DOCX media.

### Font size decimal (.5) input broken

- **SuperDoc:** [#1038](https://github.com/superdoc-dev/superdoc/issues/1038) (closed)
- **Issue:** Typing "10.5" in font size toolbar input becomes "105". Decimal point handling broken.
- **Applies to us:** CHECK. Test our font size picker with decimal values (10.5, 12.5 are common Word sizes).

---

## MEDIUM PRIORITY - Paste from External Sources

### Google Docs paste loses text alignment

- **SuperDoc:** [#2149](https://github.com/superdoc-dev/superdoc/issues/2149) (closed/fixed)
- **Issue:** Google Docs sends alignment as inline `text-align` CSS on `<p>` elements. Not preserved on paste.
- **Applies to us:** CHECK. Test pasting centered/right-aligned text from Google Docs.

### Google Docs paste loses line spacing and indentation

- **SuperDoc:** [#2151](https://github.com/superdoc-dev/superdoc/issues/2151) (closed/fixed)
- **Issue:** Line spacing and paragraph indentation from Google Docs paste lost. Google Docs uses inline CSS `lineHeight`, `marginLeft`, etc.
- **Applies to us:** CHECK. Test pasting formatted paragraphs from Google Docs.

### Google Docs paste loses heading levels

- **SuperDoc:** [#2152](https://github.com/superdoc-dev/superdoc/issues/2152) (closed)
- **Issue:** Google Docs converts headings to `<p>` with inline font-size/weight instead of semantic `<h1>`-`<h6>`. Only H2 preserved.
- **Applies to us:** CHECK. Test pasting headings from Google Docs.

### Google Docs paste loses table cell styles

- **SuperDoc:** [#2150](https://github.com/superdoc-dev/superdoc/issues/2150) (open)
- **Issue:** Table cell background colors, borders, padding lost when pasting from Google Docs.
- **Applies to us:** CHECK. Test pasting styled tables from Google Docs.

---

## MEDIUM PRIORITY - Table Pagination

### Table rows splitting across pages with visual glitches

- **SuperDoc:** [#1585](https://github.com/superdoc-dev/superdoc/issues/1585) (closed), [#1586](https://github.com/superdoc-dev/superdoc/issues/1586) (closed)
- **Issue:** When table rows split across pages: text overlapping, misaligned borders, inconsistent line breaks. Header rows don't repeat on continuation pages.
- **Applies to us:** POSSIBLE. Our table pagination in layout-painter needs testing with large multi-page tables, especially with merged cells and header rows.

### Table margins not adaptive like Word

- **SuperDoc:** [#864](https://github.com/superdoc-dev/superdoc/issues/864) (open)
- **Issue:** Wide tables exceed page margins. Word auto-adjusts but editor doesn't.
- **Applies to us:** POSSIBLE. Check how we handle tables wider than the content area.

---

## LOW PRIORITY - Performance

### Slow loading for 200+ page documents

- **SuperDoc:** [#1183](https://github.com/superdoc-dev/superdoc/issues/1183) (closed)
- **Issue:** Documents with 200+ pages take >60 seconds to load. Switching browser tab causes white screen.
- **Applies to us:** POSSIBLE. Worth benchmarking with large documents. Our layout-painter renders all pages.

### Unresponsive with many tracked changes

- **SuperDoc:** [#1721](https://github.com/superdoc-dev/superdoc/issues/1721) (closed)
- **Issue:** Documents with extensive tracked changes make editor unresponsive. Scrolling, editing, and commenting very slow.
- **Applies to us:** POSSIBLE. Test with heavily track-changed documents.

---

## LOW PRIORITY - Tracked Changes / Comments

### Undo of last tracked-change suggestion leaves orphan comment

- **SuperDoc:** [#2186](https://github.com/superdoc-dev/superdoc/issues/2186) (closed/fixed)
- **Issue:** In suggesting mode, undoing the last (only) suggestion removes the highlight but leaves the comment visible.
- **Applies to us:** CHECK if we support suggesting mode. If so, test undo of last suggestion.

### Comment box shows extra letter in suggesting mode

- **SuperDoc:** [#2004](https://github.com/superdoc-dev/superdoc/issues/2004) (closed/fixed)
- **Issue:** In suggesting mode, the "Added" section in comment shows repeated last letter.
- **Applies to us:** CHECK if suggesting mode is implemented.

---

## NOT APPLICABLE TO US

The following issues are specific to SuperDoc's architecture and don't apply:

| Issue                                             | Why Not Applicable                 |
| ------------------------------------------------- | ---------------------------------- |
| #2327 - SDK positioning API                       | SuperDoc SDK/CLI specific          |
| #2158 - paraId for headless sessions              | SuperDoc headless SDK specific     |
| #2155 - Docs site images broken                   | Documentation site issue           |
| #2096 - TypeScript types for extension commands   | SuperDoc public API types          |
| #2054 - Dependency Dashboard                      | Renovate bot automated             |
| #2003 - Liveblocks websocket message too large    | Collaboration/Liveblocks specific  |
| #1982 - Product Roadmap                           | Roadmap tracking                   |
| #1874 - Y.js sync echo problem                    | Collaboration/Y.js specific        |
| #1832 - Footer shifts when printing PDF on A4     | PDF export + Chrome print specific |
| #1830 - Y.Doc update on every keystroke           | Collaboration/Y.js specific        |
| #1827 - Text typed in reverse in suggesting mode  | Y.js CRDT cursor position bug      |
| #2002 - Liveblocks initialization issue           | Collaboration specific             |
| #2020 - Angular build errors                      | SuperDoc package distribution      |
| #1901 - React invalid from v1.1.0                 | SuperDoc package distribution      |
| #415 - Vue.js HMR breaks                          | SuperDoc package interference      |
| #1614 - Liveblocks error with markdown links      | Collaboration specific             |
| #1783 - Custom footer question                    | Usage question                     |
| #1626 - Discord link expired                      | Community management               |
| #690 - Homepage demos don't run                   | Website issue                      |
| #173 - TypeError without modules config           | SuperDoc init config issue         |
| #2106 - Temp image upload                         | Internal                           |
| #1736 - Testing Linear                            | Test issue                         |
| #924 - PDF rendering broken                       | PDF viewer feature                 |
| #925 - Search on PDF                              | PDF viewer feature                 |
| #928 - setZoom by code                            | API question                       |
| #957 - Antd Upload uid issue                      | Framework-specific                 |
| #887 - insertContent HTML invalid                 | API-specific                       |
| #842 - Line break with \n\n                       | API-specific                       |
| #1136 - Deleting at \n\n affects other paragraphs | API-specific                       |
| #1137 - Search regex positions incorrect          | API-specific                       |
| #993/#994 - Track changes Chinese text            | Input composition specific         |
| #958 - Some files fail with pagination            | Generic                            |
| #1131 - Breaks loading document with table        | Bookmark/tableCell schema issue    |
| #1268 - Document editing broken                   | Generic                            |
| #836 - Search and replace how-to                  | Usage question                     |
| #833 - isInTable() usage                          | API question                       |
| #817 - setZoom help                               | API question                       |
| #813 - Title number missing in getJSON            | API-specific                       |
| #791 - getJSON with fields                        | API-specific                       |
| #790 - Image export from insertContent            | API-specific                       |
| #781 - Slash menu items missing                   | Feature-specific                   |
| #752 - python-docx comments not supported         | Comment parser edge case           |
| #2005 - Error clicking track changes text         | Track changes specific             |
| #629 - Converter not working                      | Generic                            |
| #1583 - goToSearchResult scroll                   | API-specific                       |
| #1019 - .doc file support                         | Legacy format                      |
| #962 - HTML export                                | Feature request                    |
| #893 - Table data hook                            | API feature request                |
| #996 - Search fails across comments               | Search API specific                |
| #995 - InsertTable with adaptive width            | API feature request                |
| #1087 - Table options tooltip missing             | Minor UI (covered separately)      |

---

## Summary

| Category                                  | Count | Action                         |
| ----------------------------------------- | ----- | ------------------------------ |
| Rendering/Layout bugs likely affecting us | 11    | Investigate and test           |
| Data roundtrip/export bugs to verify      | 6     | Test with specific DOCX files  |
| Editing interaction bugs to check         | 12    | Test in browser                |
| OOXML feature gaps to verify              | 9     | Check parser/renderer          |
| Paste handling to verify                  | 4     | Test with Google Docs          |
| Table pagination to verify                | 3     | Test with large tables         |
| Performance to benchmark                  | 2     | Load test with large docs      |
| Tracked changes to verify                 | 2     | Check if relevant to our modes |
| Not applicable                            | 38    | Skip                           |

**Top 5 to investigate first:**

1. Paragraph `between`/`bar` borders - likely missing in our rendering
2. Image text wrapping - known TODO in our code
3. TOC tab leader overlap - layout calculation issue
4. Highlight export OOXML validity - data corruption risk
5. Arrow key navigation / auto-scroll - UX critical
