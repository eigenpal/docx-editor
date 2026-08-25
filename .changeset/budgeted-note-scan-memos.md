---
'@docx-editor.dev/core': patch
---

Reduce per-keystroke latency on documents with footnotes or endnotes: mutation-path note-reference scans reuse per-subtree results instead of re-walking the whole package.
