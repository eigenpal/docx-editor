# @docx-editor.dev/docx-to-pdf

## 2.34.0

### Minor Changes

- 55e7541: PDF export now shows tracked changes by default (`displayMode: 'all-markup'`) with changed-line bars, and a document with comments shrinks each page beside a markup pane that shows every comment as a balloon. Set `displayMode: 'proposed'` to keep the previous output.
- 9f098f2: PDF export reports a metafile picture that stops at a malformed record as `metafile-record`, and keeps `metafile-limit` for a picture that stops at a resource bound. The font notice no longer lists a face that only hidden text or a hidden symbol uses.

### Patch Changes

- 94d7d1c: A comment balloon in PDF export now stands on the page where its range ends, also when a split table row carries part of the range onto a later page.
- 5abd50f: A localized East Asian font name, such as メイリオ, now resolves to the face supplied under its English name, and a missing bold or italic face of an East Asian family draws in that family's regular face. Fixes #1647.
- afca693: PDF export parses merged equation text in linear time and no longer writes two adjustment numbers without a separator.
- 6505457: Equations with spaced operators paint each source run as one text span, and PDF export writes one text object per face and baseline, so pages with many operators paint faster and export smaller. Fixes #1560.
- 233aeaa: Text in Garamond keeps the font's own line height when the font is not available, so its line spacing and page breaks no longer depend on the fallback font. Fixes #563.
- 752d5fb: Kana compression keeps a kana and its spaced sound mark on a full line, and PDF text gives a kana and a joined sound mark as the precomposed character. Fixes #1638.
- 620b7ca: Markdown conversion and PDF export build against the latest layout records again.
- 45cd6f8: EMF and WMF pictures in PDF export take the picture's brightness and contrast, so a washed-out picture watermark exports faded, and a metafile that stops at a malformed record reports a diagnostic instead of exporting blank. With the default strict fidelity policy, grayscale or black-and-white metafile pictures and metafiles that stop early now reject the export; use `'best-effort'` to keep them. Fixes #1338.
- f7baed2: PDF export paints equations with an overline or underline bar and draws equation text in the same face that layout measured.
- 78abf89: PDF export draws highlight, shading, strikethrough, every underline style, and tracked-change marks continuously across the gaps of justified and distributed lines, as the editor does.
- 5abd50f: Symbols that the text fonts lack, such as ballot boxes, no longer make their line taller than the symbol fallback font does when a packaged font draws them. Fixes #1648.
- Updated dependencies: @docx-editor.dev/core@2.34.0, @docx-editor.dev/fonts-cjk@2.34.0, @docx-editor.dev/fonts@2.34.0, @docx-editor.dev/pro@2.34.0

## 2.33.0

### Minor Changes

- 2b4c7b8: Render authored diagonal cell borders in the editor and PDF export.

### Patch Changes

- 0c90746: PDF export keeps an Arabic word when a symbol beside it in the same run, such as a checkbox, is missing from its font.
- f85416f: GIF pictures and picture bullets now appear in PDF export, drawn from their first frame with transparency kept.
- Updated dependencies: @docx-editor.dev/core@2.33.0, @docx-editor.dev/fonts-cjk@2.33.0, @docx-editor.dev/fonts@2.33.0, @docx-editor.dev/pro@2.33.0

## 2.32.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.32.0, @docx-editor.dev/fonts-cjk@2.32.0, @docx-editor.dev/fonts@2.32.0

## 2.31.0

### Patch Changes

- 02b31d7: Long documents with justified text, footnotes, tables, and SimSun text now break lines and pages more accurately. PDF export now completes long documents and uses installed Garamond and large CJK fonts.
- 784b7d7: Preserve authored vector line caps and round or bevel joins in SVG and PDF output.
- Updated dependencies: @docx-editor.dev/core@2.31.0, @docx-editor.dev/fonts-cjk@2.31.0, @docx-editor.dev/fonts@2.31.0

## 2.30.0

### Minor Changes

- f09b44b: Add the `fontShaping` option, which sets the largest font file that text shaping accepts, separately from font loading limits.

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.30.0, @docx-editor.dev/fonts-cjk@2.30.0, @docx-editor.dev/fonts@2.30.0

## 2.29.0

### Patch Changes

- 3877653: Text copied or searched in exported PDFs now lines up with the painted words after tabs, hidden text, and list markers.
- Updated dependencies: @docx-editor.dev/core@2.29.0, @docx-editor.dev/fonts-cjk@2.29.0, @docx-editor.dev/fonts@2.29.0

## 2.28.0

### Patch Changes

- 9535470: With `revisionsIn: 'balloons'`, comments that reply to tracked changes no longer open an empty review pane, and the new `reviewPaneListsItem` export tells a custom review pane which items to list. PDF export marks text in tracked table rows inside text boxes.
- Updated dependencies: @docx-editor.dev/core@2.28.0, @docx-editor.dev/fonts-cjk@2.28.0, @docx-editor.dev/fonts@2.28.0

## 2.27.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.27.0, @docx-editor.dev/fonts-cjk@2.27.0, @docx-editor.dev/fonts@2.27.0

## 2.26.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.26.0, @docx-editor.dev/fonts-cjk@2.26.0, @docx-editor.dev/fonts@2.26.0

## 2.25.0

### Patch Changes

- Updated dependencies [5d02def]
- Updated dependencies [95fbca3]
- Updated dependencies [e151687]
- Updated dependencies [5d02def]
- Updated dependencies [5d02def]
- Updated dependencies [95fbca3]
- Updated dependencies [7ac4f41]
- Updated dependencies [f098ae6]
- Updated dependencies [a13f6a7]
- Updated dependencies [5d02def]
  - @docx-editor.dev/core@2.25.0
  - @docx-editor.dev/fonts@2.25.0
  - @docx-editor.dev/fonts-cjk@2.25.0

## 2.24.0

### Patch Changes

- 79d8bc1: Reduce repeated font metric reads and number formatting during PDF export.
- 79d8bc1: Reduce the time needed to compare PDF page colors.
- Updated dependencies [3a8853f]
- Updated dependencies [de3aac8]
- Updated dependencies [79d8bc1]
- Updated dependencies [997814e]
- Updated dependencies [de3aac8]
  - @docx-editor.dev/core@2.24.0
  - @docx-editor.dev/fonts@2.24.0
  - @docx-editor.dev/fonts-cjk@2.24.0

## 2.23.0

### Minor Changes

- dbed488: The Noto Sans CJK JP fallback font moves to the optional `@docx-editor.dev/fonts-cjk` package, which reduces the PDF converter download by about 13 MB. Install `@docx-editor.dev/fonts-cjk` to keep CJK text rendering on hosts without CJK fonts.

### Patch Changes

- 30bd2a8: Add evaluation tools for page layout, source text locations, and cached page-word screening.
- e608e2d: PDF export now draws Hebrew text in a run whose font has no Hebrew glyphs in Times New Roman, or in Liberation Serif where Times New Roman is not installed, instead of dropping it.
- e608e2d: PDF export now refuses a font glyph whose composite parts nest too deeply or refer to themselves, instead of hanging or failing the whole export.
- e608e2d: PDF export no longer draws wrong glyph shapes when a large Arabic document fills the embedded font past its short offset limit.
- e608e2d: PDF export now draws synthetic bold and italic text when the font has no bold or italic face, such as bold Arabic in Noto Sans Arabic.
- e608e2d: Text copied or extracted from exported PDFs now reads Arabic, Persian, Urdu and Hebrew lines in logical order as whole words, in MuPDF, Poppler and pdf.js.
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [b981ea6]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [0e42c85]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [d04902a]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [a2951cf]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [ab460dc]
- Updated dependencies [30bd2a8]
- Updated dependencies [e633def]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [cee5764]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [390c177]
- Updated dependencies [30bd2a8]
- Updated dependencies [ae1afe0]
- Updated dependencies [30bd2a8]
- Updated dependencies [bf776f2]
- Updated dependencies [30bd2a8]
- Updated dependencies [d6c75d2]
- Updated dependencies [2eea4de]
- Updated dependencies [30bd2a8]
- Updated dependencies [e040ff8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [aab4053]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [e608e2d]
- Updated dependencies [30bd2a8]
- Updated dependencies [9afb832]
- Updated dependencies [6794f4d]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
- Updated dependencies [30bd2a8]
  - @docx-editor.dev/core@2.23.0
  - @docx-editor.dev/fonts@2.23.0
  - @docx-editor.dev/fonts-cjk@2.23.0

## 2.22.0

### Minor Changes

- 648f13c: Add DOCX to PDF conversion for Node.js under the EigenPal Pro License.

### Patch Changes

- ac84ccf: Convert long documents to PDF about twice as fast, and shape text faster in the editor and in headless exports. Page content is unchanged, but compressed PDF stream bytes can differ.
- Updated dependencies [139688b]
- Updated dependencies [d98b6d8]
- Updated dependencies [abc656b]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [9912e81]
- Updated dependencies [7ff2004]
- Updated dependencies [fe66ece]
- Updated dependencies [ac84ccf]
- Updated dependencies [cde01d8]
- Updated dependencies [648f13c]
- Updated dependencies [95c792f]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [23093e9]
- Updated dependencies [edfb06d]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [07718bd]
- Updated dependencies [d98b6d8]
- Updated dependencies [e6616fe]
- Updated dependencies [1bb2434]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [139688b]
- Updated dependencies [a893c05]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [9db7eb3]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
- Updated dependencies [07718bd]
  - @docx-editor.dev/core@2.22.0
  - @docx-editor.dev/fonts@2.22.0
