---
'@eigenpal/docx-editor-core': patch
---

Fix a header (or footer) containing a page/margin-anchored shape — e.g. a full-page letterhead banner — inflating its interactive box to cover the whole page, which blocked clicks into the body text. The header/footer box now tracks the in-flow band height, and its overflowing anchored content is non-interactive in normal mode so the document text underneath stays clickable.
