---
'@docx-editor.dev/react': patch
---

The save/reopen oracle now covers the whole document. It walked only the body's direct paragraphs, so everything inside a table cell or a block content control sat outside it — on a 574-paragraph document, 239 were checked. A round trip that emptied a table cell reported no differences at all. A standing test now asserts the oracle reaches every paragraph of a part, alongside element-census checks that an ordinary edit, saved and reopened, loses no class of content.
