---
'@eigenpal/docx-editor-core': patch
---

Fix list-marker alignment when a list paragraph's direct indent has a `hanging` value larger than its `left` indent. The marker now hangs into the left margin to align with the surrounding text (matching Word) instead of being clamped to the content edge and shifted right. Fixes #729.
