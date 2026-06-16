---
'@eigenpal/docx-editor-core': patch
---

Render VML pictures (e.g. legacy header logos) instead of dropping them, and stop the watermark parser from claiming a non-watermark VML picture. Anchored images now follow their own `wp:positionH` alignment, defaulting to left like Word, rather than inheriting the paragraph alignment.
