---
'@docx-editor.dev/core': patch
---

Hyperlinks in headers, footers, and anchored text boxes now resolve through their owning OOXML part and paint as link anchors. You can edit or remove header and footer links with Ctrl+K while editing their story; secondary-story anchors remain inert. Fixes #643.
