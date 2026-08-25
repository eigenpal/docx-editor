---
'@docx-editor.dev/core': patch
---

Fix the image selection overlay keeping the drawing's old frame after a resize, move, wrap, or transform: image ops now commit through the same layout/paint tail as keystrokes, and overlay geometry reads flush any pending layout pass first.
