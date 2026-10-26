---
'@docx-editor.dev/core': patch
---

Unsupported drawing placeholders take their label from one translation key per kind, `image.placeholder.<kind>`, which replaces `image.nonPictureGraphic`; move an override of the old key to the new keys.
