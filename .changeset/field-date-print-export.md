---
'@docx-editor.dev/core': minor
---

Print and PDF export from the editor pass its `fieldDate` to the PDF handler as `ChromeExportView.fieldDate`, and `exportPdf`, `exportMarkdown`, and `openDocumentForExport` take a `fieldDate` option, so exported `DATE` and `TIME` fields can show the same date as the editor. The saved document keeps its saved results.
