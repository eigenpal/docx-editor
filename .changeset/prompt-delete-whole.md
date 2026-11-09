---
'@docx-editor.dev/core': patch
---

Delete and Backspace no longer remove part of a content control placeholder: the first press selects the placeholder and the next removes the control, and suggesting mode proposes the control's deletion. Copy and cut over part of a placeholder take the whole placeholder.
