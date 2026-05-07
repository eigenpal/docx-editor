---
'@eigenpal/docx-js-editor': patch
---

Fix style-cascade gaps for runs without an explicit `<w:rStyle>` and tables without an explicit `<w:tblStyle>`. Per ECMA-376 §17.7.4.18, both should inherit from the document's default style of the same type (the one marked `w:default="1"`); pre-PR the default character style was skipped entirely (only docDefaults.rPr reached such runs), and the table-borders cascade was hardcoded to look up styleId `"TableGrid"` instead of the parsed default flag.

- `StyleResolver.getDefaultCharacterStyle()` finds the default by `w:default="1"` flag (varies by language: "Default Paragraph Font", "FontePadrao", "Fontepargpadro", etc.).
- `resolveRunStyle()` now applies the cascade `docDefaults.rPr → default character style → explicit character style`, matching the cellMargins / paragraph cascade pattern.
- `resolveTextFormatting()` no longer short-circuits when a run has no `styleId` — it always consults the full cascade.
- Table borders cascade replaces the hardcoded `getStyle('TableGrid')` with `getDefaultTableStyle()`, matching the cellMargins cascade and working for documents whose default table style has any styleId.

5 new unit tests cover the default character style cascade and the `getDefaultCharacterStyle()` helper. All 449 core tests pass (was 445).

Refs #412.
