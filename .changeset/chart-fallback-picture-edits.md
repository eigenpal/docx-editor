---
'@docx-editor.dev/core': patch
---

Picture commands on a chart's saved fallback picture are now refused, deleting that picture removes the whole chart, and `drawing.chart` is present on every chart drawing, whether it renders, shows its fallback picture, or shows the placeholder.
