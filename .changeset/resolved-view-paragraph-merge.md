---
'@docx-editor.dev/core': minor
---

The resolved display modes now merge the paragraphs their decisions merge, in the body, in table cells, and in headers and footers: a paragraph whose mark a tracked change deleted runs into the next one in the final view, as it does in Word and as accepting the change already did. Accepting a run of deleted paragraph marks also collapses them into one paragraph rather than into pairs, and no longer carries content past a table or a content control.
