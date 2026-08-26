---
'@docx-editor.dev/pro': patch
---

Fix silent data loss where a local edit that a remote update raced could overwrite text or delete a paragraph nobody touched, by replicating each edit on the commit that makes it.
