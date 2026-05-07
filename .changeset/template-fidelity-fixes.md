---
'@eigenpal/docx-js-editor': patch
---

Three Word-fidelity fixes surfaced by the Metal Nobre "DC_Template_Descricao_Cargo" template:

- **Inline images no longer overflow their containing line.** Browsers compute a non-integer height for `<img>` from the natural aspect ratio when only `width`/`height` attributes are set, which clipped images sized in EMU (e.g. wp:extent `1771650×278918` rounds to `186×29` px but the natural ratio gave `29.29` px). Width/height are now also pinned via inline style, and the inline-image vertical alignment is the default `baseline` rather than `middle` — `middle` adds half-x-height of parent-font leading and pushed the image past the bottom of any line sized to fit just the image (the typical "image alone in a table cell" case).
- **Explicit `w:before` is honored on the first paragraph of a page/column.** The pageComposer was unconditionally zeroing `spaceBefore` whenever the cursor was at `topMargin`, which dropped Word-authored leading space (e.g. `w:before="1800"` on the title paragraph). Word 2013+ honors explicit before-spacing at the top of a page; trailing-spacing is already reset on new-page so applying it here does not carry spacing across page breaks.
- **A hard `<w:br w:type="page"/>` in an otherwise-empty paragraph now forces a page break.** `paragraphHasPageBreak` previously required preceding visible content (relying on `renderedPageBreakBefore` to cover leading breaks), but that attr is informational only and not honored at layout, so an empty paragraph containing just a page-break run silently dropped the break.
