---
'@docx-editor.dev/react': minor
---

Page setup is now editable: a Page Setup dialog (`DocxEditor.PageSetupDialog`), draggable ruler margins, and a `usePageSetup` hook over the new `setPageSetup` command. Changes apply to the whole document — every section — as one undo step, and page setup joins the editor snapshot as `snapshot().pageSetup`. Documents storing landscape dimensions without the `w:orient` attribute now report landscape.
