---
'@docx-editor.dev/core': minor
'@docx-editor.dev/react': minor
'@docx-editor.dev/vue': minor
'@docx-editor.dev/i18n': minor
---

File > Print now asks which markup to print and whether comments print, and passes the choice to the PDF handler as `view.displayMode` and `view.comments`. Set `printSettings: false` on the menu to print the current view without asking.
