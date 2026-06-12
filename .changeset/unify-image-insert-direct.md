---
'@eigenpal/docx-editor-vue': patch
'@eigenpal/docx-editor-core': patch
---

Vue: insert images directly from Insert > Image like React — the OS file picker opens and the image is placed inline, fitted to the page width, with no intermediate dialog. This also fixes a tall empty gap that appeared below an inserted image wider than the page column. The read-file-fit-and-insert flow now lives in core (`insertImageFromFile`), so React and Vue share one code path and behave identically.
