---
'@docx-editor.dev/react': patch
---

Lists created by the editor now produce a `numbering.xml` Word accepts. Level definitions and new list entries are written in the order the format requires, the part's content type is always declared, and bullet glyphs match the ones Word writes. Previously Word reported the file as unreadable, repaired it, and dropped every list in the document.
