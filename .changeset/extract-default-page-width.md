---
'@eigenpal/docx-js-editor': patch
---

Replace hardcoded `816` page-width literals in `DocxEditor` with the existing
`DEFAULT_PAGE_WIDTH` constant exported from `PagedEditor`, and fold the two
duplicated `pageWidth` fallback expressions into a single `pageWidthPx` value
shared by `UnifiedSidebar` and `CommentMarginMarkers`.
