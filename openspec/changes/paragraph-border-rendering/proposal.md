# Paragraph Border Rendering: `between` and `bar`

## Problem

Our paragraph border rendering only handles the 4 standard sides (`top`, `right`, `bottom`, `left`). Two OOXML border types are parsed but silently dropped:

1. **`w:between`** — horizontal line drawn between consecutive paragraphs that share the same border group (e.g., callout boxes, grouped list items). Defined in OOXML spec 17.3.1.24.
2. **`w:bar`** — vertical decorative bar rendered on the left side of a paragraph. Defined in OOXML spec 17.3.1.4.

Documents using these borders for visual grouping (legal documents, callout boxes, styled lists) render without their separators/bars, breaking fidelity with Word.

## Scope

- Render `w:between` borders as horizontal lines between consecutive paragraphs in the same border group
- Render `w:bar` borders as vertical lines on the left side of paragraphs
- Parser already handles these; fix is in the layout-painter rendering pipeline

## Out of scope

- Editing/adding borders via toolbar (existing border UI is fine)
- Border style variations beyond what CSS supports
