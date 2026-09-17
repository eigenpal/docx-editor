---
'@docx-editor.dev/core': minor
---

Render `w:pgBorders` page frames. Section properties now resolve the element (`w:offsetFrom`, which defaults to `text` and not `page`, plus `w:display` and `w:zOrder`), layout publishes the four rules as page-box-relative stroke boxes on each sheet it belongs to, and paint draws them through the same `ST_Border` mapping paragraph rules use. `w:display` filters per section, so `firstPage` draws once per section rather than once per document; `w:zOrder` places the frame before or after the page content. Sheets that note overflow adds resolve the frame from their own position in the section, so a `notFirstPage` frame also draws on them. Art borders (`apples`, `cabins`, …) are skipped rather than degraded to a plain rectangle.
