---
'@docx-editor.dev/core': patch
---

Typed characters now stay in order after a repaint. A repaint that followed an edit could read the browser's own selection back as the paragraph start, so the first character landed and every one after it was inserted in front of it.
