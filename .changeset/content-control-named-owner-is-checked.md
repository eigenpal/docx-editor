---
'@docx-editor.dev/react': patch
---

Refuse an insertion that names a content control it is not writing into, and refuse one that names a control whose value is bound to a custom XML part. Inserting text into a bound control through the object model changed content that still claimed to mirror its part; naming a node that was not a control let a write into a form-protected document present itself as filling in a field.
