---
'@docx-editor.dev/core': minor
'@docx-editor.dev/react': minor
'@docx-editor.dev/vue': minor
'@docx-editor.dev/i18n': minor
---

File > Print now asks which markup to print (All Markup, Simple Markup, No Markup, or Original) and whether comments print, before it converts the document. The PDF handler receives the choice as `view.displayMode` and the new `view.comments`; forward `comments` to `exportPdf`. Set `printSettings: false` on the menu to print the current view without asking. A custom `popups.print` component opts in with `printSettings: true` and the new `choosing`, `settings`, `onSettingsChange`, and `onPrint` props.

`runChromePrint` and `runChromeExport` take an optional `ChromePrintSettings` argument, and `initialChromePrintSettings` and `nextChromePrintSettings` give a custom print form the same rules. Printing now also passes the review author color slots to the PDF handler, as export already did.
