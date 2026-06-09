---
'@eigenpal/docx-editor-vue': patch
---

Fix the Vue editor's text caret disappearing or jumping to the wrong place while typing. The caret/selection overlay now repaints through the layout gate (after the page repaints) instead of synchronously against stale DOM, so the caret stays visible and follows the insertion point. Fixes #736.
