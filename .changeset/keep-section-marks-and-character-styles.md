---
'@docx-editor.dev/react': patch
---

Edits no longer discard the parts of a paragraph they cannot express. Centring the last paragraph of a section keeps the section break; bold keeps a run's character style and language; merging two paragraphs keeps the section boundary; splitting a paragraph leaves hyperlinks, pictures, bookmarks and comment anchors where they were written; and paragraph properties are saved in the order Word requires.
