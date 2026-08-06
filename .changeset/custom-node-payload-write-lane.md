---
'@docx-editor.dev/pro': minor
---

A custom node can now be written with a payload: `insertCustomNode` and `updateCustomNode` take `data`, typed by the definition's `schema` and stored in a customXml data part the control binds to, so a node is no longer limited to the 64 characters `w:tag` holds. Recognition hands that payload back typed, `exportCustomNodes` applies `preserveOnExport`, and `customNodeXml` answers the store parts a server-side splice has to add.
