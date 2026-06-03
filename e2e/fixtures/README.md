# Test Fixtures

This directory contains DOCX test fixtures for the Playwright test suite.

## Files

### empty.docx

An empty DOCX document with default Word settings.
Used for testing baseline document state.

### styled-content.docx

A document containing styled content:

- Bold, italic, and underlined text
- Different font sizes
- Paragraph with alignment variations
- Mixed formatting

### with-tables.docx

A document containing tables:

- Simple 3x3 table
- Table with merged cells
- Table with formatted content

### complex-styles.docx

A document with complex styling:

- Custom styles
- Theme colors
- Headers/footers
- Multiple sections

### wrap-none-positioned-image-demo.docx

A synthetic document containing a positioned image anchored with `wp:wrapNone`.
Used to reproduce anchored images that should paint independently without adding
paragraph flow height or text-wrap margins.

### wrap-none-two-seals-title-box-demo.docx

A synthetic title-page document containing two `behindDoc` `wp:wrapNone` images
aligned to the left and right margins around a centered title box. Used to
reproduce multiple non-wrapping anchored images on the same page.

### image-layout-modes-demo.docx

A synthetic document containing exactly one image of each of Word's three core
layout modes — `wp:inline` (in-line), `wp:wrapSquare` (wrap-around float), and
`wp:wrapTopAndBottom` (full-width block) — in a single document. Used by
`e2e/tests/image-layout-modes.spec.ts` to lock in correct rendering of all
three paths side by side.

### issue-472-floating-textbox.docx

A synthetic document containing a `wps:wsp` text box in a `wp:anchor` with
`wp:wrapSquare wrapText="bothSides"`. Used to reproduce issue #472 without
committing the private original document.

### footnote-bottom-overflow.docx

A synthetic document containing dense bottom-of-page footnote references with
long citation-like note text. Used to verify that final footnote reservation and
painted footnote height agree so notes do not run off the page.

### endnotes-tracked-changes.docx

A synthetic document with two body endnote references, separator and
continuation-separator endnotes, and a normal endnote whose body contains a
tracked insertion (`w:ins`). Used to verify the note-body serializer round-trip
(separators + `w:endnoteRef` survive repack) and `getChanges({ includeEndnotes })`.

### empty-table-row-vmerge.docx

A synthetic document containing a table whose middle row is made entirely of
`w:vMerge` continuation cells. Used to verify that DOCX import does not produce
an invalid empty ProseMirror `tableRow`.

### toc-hyperlink-tabs.docx

A synthetic document with one TOC1 paragraph wrapping
`1[tab]Introduction[tab]5` inside a `<w:hyperlink>`, plus the TOC1 style with
its right-aligned dot-leader tab stop. Used to verify that tabs inside
hyperlinks survive parsing and that TOC entries render with dot leaders and
right-aligned page numbers like Word.

## Generating Fixtures

To regenerate fixtures, run:

```bash
bun run e2e/fixtures/generate-fixtures.ts
bun scripts/create-issue-472-floating-textbox-fixture.mjs
bun scripts/create-footnote-bottom-overflow-fixture.mjs
bun scripts/create-empty-table-row-vmerge-fixture.mjs
bun scripts/create-toc-hyperlink-fixture.mjs
```

Or manually create them using Microsoft Word or another DOCX editor.
