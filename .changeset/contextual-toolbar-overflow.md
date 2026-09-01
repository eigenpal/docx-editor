---
'@docx-editor.dev/core': patch
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Treat contextual table controls as the first collapsible preset-toolbar group, so entering a table moves those controls into More before ordinary formatting controls instead of overlapping them. Keep table color pickers contained within the More panel so later controls remain clipped and scrollable while a picker is open. Fixes #669.
