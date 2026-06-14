---
'@eigenpal/docx-editor-vue': patch
---

The Vue toolbar's paragraph-style picker now reflects the loaded document's real styles (names and order) instead of a fixed preset list, matching React's behaviour (e.g. it shows the document's "Normal" style name). Falls back to the built-in presets when a document has no styles. Also aligns the toolbar's font-size box border and active-button colour exactly with React.
