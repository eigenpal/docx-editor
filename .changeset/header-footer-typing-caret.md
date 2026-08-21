---
'@docx-editor.dev/core': patch
---

Fixed the caret jumping back to the start of a header or footer after each character typed. The `change` event's revision and `getDocumentHandle().revision` now rise for every edit, including one made in a header, footer or note, and an explicit table target is no longer refused as stale after such an edit. Fixes #361
