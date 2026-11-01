---
'@docx-editor.dev/core': patch
---

Text whose font is written as a list, such as `Verdana, Geneva, sans-serif`, now renders in the first font of the list, and text whose font name no font can carry, such as `"Open Sans", sans-serif`, renders in Cambria instead of disappearing from PDF export.
