---
'@eigenpal/docx-editor-vue': patch
---

Vue: fix the image selection frame appearing shifted off the image. Selecting an image right after a document loads measured the frame one frame before the page finished re-centering, stranding it to the side; the overlay now re-anchors across the layout settle (and across zoom transitions) so the frame keeps wrapping the image tightly. It also re-anchors when the comments sidebar slides the page sideways while an image stays selected, which previously left the frame stranded to the side until the next scroll.

Fixes #764
