---
"@docx-editor.dev/react": patch
---

Fix text wrapping around floating images. Wrapped lines now use the full column instead of about half of it, tight and through wrap polygons exclude the whole picture, a top-and-bottom image sits above the text it displaces rather than on top of it, and text fills both sides of a centred float.
