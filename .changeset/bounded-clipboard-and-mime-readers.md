---
'@docx-editor.dev/core': patch
---

Pasting from an application that offers only an HTML flavour now recovers its text more faithfully: an attribute value holding a `>` no longer truncates the paste, unterminated markup is no longer pasted as literal text, and a very large table no longer blocks the page. Reading a document's content types no longer uses a pattern a crafted file could make backtrack.
