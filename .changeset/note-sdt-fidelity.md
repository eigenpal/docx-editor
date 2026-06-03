---
'@eigenpal/docx-editor-core': patch
---

Content controls (`w:sdt`) inside footnote and endnote bodies now round-trip through the editable model instead of freezing the whole note to a verbatim copy. Notes whose only block-level construct is a content control stay fully editable; the verbatim fallback now applies only to notes carrying block-level bookmarks or `w:customXml`.
