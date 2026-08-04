---
'@docx-editor.dev/react': patch
---

Keep typing responsive on long documents: the review and comment queues now re-read only the paragraphs a commit touched instead of walking the whole document on every keystroke. On an 878-paragraph agreement that is 49ms of per-keystroke work down to 4ms, whether or not the document has tracked changes.
