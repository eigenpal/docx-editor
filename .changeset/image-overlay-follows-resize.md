---
'@docx-editor.dev/core': patch
---

Fix the image selection overlay keeping the drawing's old frame after a resize, move, wrap, or transform. Image ops now commit through the same layout/paint tail as keystrokes, and multi-section layout no longer republishes a previous pass's sheets for a section that changed inside a balancing or re-run pass.
