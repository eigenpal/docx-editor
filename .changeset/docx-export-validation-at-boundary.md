---
'@eigenpal/docx-editor-core': patch
---

Fix DOCX export validation at the source: normalize out-of-range paraId/textId and drop orphan comment anchors when parsing, preserve internal-target hyperlinks instead of rewriting them as external, unwrap targetless hyperlinks, and always emit a valid table grid.
