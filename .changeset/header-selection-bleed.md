---
'@eigenpal/docx-js-editor': patch
---

Fix selection highlights bleeding from body into headers and footers. When body and header content shared low PM positions (because each is parsed as a separate ProseMirror document), the DOM-based selection painter matched both trees and drew phantom rectangles on every header and footer. Selection rectangles and caret lookups are now scoped to `.layout-page-content`.
