---
'@eigenpal/docx-editor-core': patch
---

Fix printing blank pages past the first few in large documents. Virtualized off-screen pages were cloned as empty shells; print now forces every page to render first. Fixes #579
