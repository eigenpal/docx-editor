---
'@eigenpal/docx-js-editor': patch
---

Footnote rendering now routes through the body pipeline (`footnoteToProseDoc → buildBoxTree → measureBlocks`), eliminating the shadow stack in `footnoteLayout.ts`. Footnotes inherit the full block-kind support of the body — paragraph, table, image, textBox, fields. Pre-PR a footnote that contained a table silently dropped the table; same for inline images and PAGE/NUMPAGES fields.

The fix mirrors the header/footer unification (#356/#357/#358):

- **Parser:** `parseFootnote` and `parseEndnote` now walk all child blocks (`<w:p>` + `<w:tbl>`) in document order. The `Footnote.content` and `Endnote.content` types widen from `Paragraph[]` to `(Paragraph | Table)[]` to match the body / HeaderFooter / TableCell shape and reflect ECMA-376 §17.11.10.
- **Converter:** new `footnoteToProseDoc` next to `headerFooterToProseDoc`; takes `(Paragraph | Table)[]` and produces a PM doc using the same `convertParagraphWithTextBoxes` / `convertTable` machinery the body uses.
- **Render adapter:** `convertFootnoteToContent` and `buildFootnoteContentMap` move from `core/layout-bridge/footnoteLayout.ts` to `react/.../PagedEditor.tsx`, parallel to `convertHeaderFooterToContent`. Footnote-specific presentation (default 8pt font, prepended display number as superscript) lives as a small post-process layer (`applyFootnotePresentation`).
- **Cleanup:** `footnoteLayout.ts` shrinks from 293 lines to ~80 — only the page-mapping helpers remain (`collectFootnoteRefs`, `mapFootnotesToPages`, `calculateFootnoteReservedHeights`).

Refs #378.
