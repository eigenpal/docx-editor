---
'@eigenpal/docx-editor-vue': patch
---

Vue: show the hyperlink popup when clicking a link in a header or footer. The click handler now resolves against the active header/footer editor (matching the body and React behavior) instead of the body, and no longer ignores links whose URL is empty.

Fixes #692
