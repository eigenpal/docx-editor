---
'@eigenpal/docx-editor-vue': patch
---

Vue: fix the image selection frame being offset from the image at zoom levels other than 100%. The overlay lives in the unscaled scroll viewport, so it now positions at post-scale pixels and scales its border/handles with the zoom factor, wrapping the image tightly. It also re-anchors when the zoom transition settles.

Fixes #695
