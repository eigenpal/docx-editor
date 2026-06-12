---
'@eigenpal/docx-editor-core': patch
---

Fix a tall empty gap appearing below an inline image that is wider than the page column. The painter fits such an image to the column width (scaling its height down), but the line height still reserved the image's unscaled height. The measurement now reserves the rendered (scaled) height, so the image and the following text sit flush. Most visible when inserting a large image in the Vue editor.
