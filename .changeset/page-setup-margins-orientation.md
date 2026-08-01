---
'@docx-editor.dev/react': minor
---

Page setup is now editable and sections paginate individually. A Page Setup dialog (`DocxEditor.PageSetupDialog`) with Word's "Apply to: Whole document / This section", draggable ruler margins, a `usePageSetup` hook, and next-page section break insertion (`insertBreak` with kind `section`). Every section lays out against its own page geometry, so documents mixing portrait and landscape pages render as Word shows them; the rulers and `snapshot().pageSetup` follow the caret's section. A whole-document orientation flip swaps each section's own dimensions, preserving distinct paper sizes. Documents storing landscape dimensions without the `w:orient` attribute now report landscape.
