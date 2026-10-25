---
'@docx-editor.dev/core': minor
---

Picture edits on a chart are now refused whether it is drawn, shows its saved fallback, or shows a placeholder, deleting a chart removes it with its fallback, and `drawing.chart` is present on every chart drawing when the chart part can be read, with a new `shownAs` field that says how the page shows it.
