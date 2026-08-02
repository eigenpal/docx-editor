---
'@docx-editor.dev/react': patch
---

The editor paints its own caret. The browser's native caret is one device pixel on a high-DPI screen, which reads as a rendering artefact rather than a cursor, and it could not be drawn at all on a newly created empty paragraph — pressing Enter left no visible caret. The painted caret positions from the line geometry layout publishes, so an empty paragraph and a new list item both get one, and it is two pixels wide like every desktop word processor. The native caret returns for the duration of an IME composition, so candidate windows still have an insertion point to anchor to.
