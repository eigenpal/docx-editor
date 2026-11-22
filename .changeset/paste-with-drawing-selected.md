---
'@docx-editor.dev/core': patch
---

While a drawing is selected, a paste or an inserted picture goes in before the drawing's anchor, and text pasted on a selected text box replaces its text. Text pasted on a shape with no text body, and pasted content that holds a picture on a text box, refuse with a reason. Fixes #2076
