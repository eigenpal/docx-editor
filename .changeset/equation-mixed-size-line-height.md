---
'@docx-editor.dev/core': patch
---

An equation whose runs differ in size no longer makes its line too tall: the first run keeps its full height, and a later, larger run adds only the height of its glyphs. Fixes #1540.
