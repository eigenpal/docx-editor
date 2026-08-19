---
'@docx-editor.dev/react': minor
---

The review rail adapts to the viewport: the full card column is reserved only while there is room for it beside the page, and narrower viewports get a centered document with a compact rail — markers in a mirrored strip, with the active card floating fully visible inside the viewport's edge. Custom chrome can read the reservation through the new `useReviewGutter` hook.
