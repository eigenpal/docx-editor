---
'@eigenpal/docx-editor-core': patch
'@eigenpal/docx-editor-react': patch
'@eigenpal/docx-editor-vue': patch
---

Assign every paragraph a stable id when a document is opened, so block ids and `getSelectionInfo().paraId` work before the first edit. Previously a document without `w14:paraId` had null ids until you typed or added a comment. Fixes #738.
