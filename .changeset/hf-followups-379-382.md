---
'@eigenpal/docx-js-editor': patch
---

Four header/footer fidelity follow-ups from the unification refactor:

- **#379** — `RenderContext.positioning` controls renderer outer position. `paintTableFragment` and `paintParagraphFragment` now pick `position: absolute` vs `position: relative` based on context, so HF / textbox callers don't have to flip inline styles after the fact. Removes the post-render `style.position` flips at three call sites.

- **#380** — Inline-vs-inherited paragraph spacing strip. `normalizeHeaderFooterMeasureBlocks` now strips `spaceBefore` / `spaceAfter` ONLY when they were resolved from a paragraph style (e.g. Normal's default 8pt-after) and not specified inline on the HF paragraph itself. Inline `<w:spacing>` is preserved per ECMA-376 §17.3.1.33; previously the blanket strip collapsed intentional Word spacing.

- **#381** — Trailing empty paragraph after a table renders at zero height. OOXML requires a trailing block-level element after the last `<w:tbl>` (the canonical convention is an empty `<w:p/>`). Word renders that paragraph as a zero-height anchor; we previously added `~14pt` of phantom space. The new `suppressEmptyParagraphHeight` flag on `ParagraphAttrs` opts the empty paragraph out of the default empty-line height fallback during measurement, while keeping the block itself for click-to-position.

- **#382** — Floating tables (`<w:tblpPr>`) honor `tblpX` / `tblpY` in headers/footers. New `resolveHeaderFooterFloatingTablePosition` resolves the anchor (`page` / `margin` / `text`) per ECMA-376 §17.4.57 and positions the table at the requested coordinates instead of inline at `cursorY`. Floating tables don't advance `cursorY` — surrounding HF blocks flow as if the table weren't there, matching Word's no-wrap behavior.

`normalizeHeaderFooterMeasureBlocks` extracted into its own file to enable unit testing.

Closes #379, #380, #381, #382.
