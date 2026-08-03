---
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Selecting text on a line that mixes font sizes now highlights each run at its own height, the way Word draws it, instead of one uniform band as tall as the largest run. Text highlight and character shading follow the same run-height band.
