---
'@docx-editor.dev/core': minor
---

The store can address the saved results of DATE, MERGEFIELD, HYPERLINK, and similar fields as editable text through a new `fieldResults: 'editable'` option on transactions, edit options, and `paragraphTextOf`. The default `atomic` mode keeps every field one unit, so existing offsets do not change.
