---
'@docx-editor.dev/core': patch
---

Typing in long documents with footnotes gets faster again: the notes pass reuses per-page footnote areas, reserves, reference hits, and mark contexts across keystrokes when nothing note-related changed, instead of re-deriving them for every page on every edit.
