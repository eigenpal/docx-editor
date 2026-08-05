---
'@docx-editor.dev/react': patch
---

Keep a document byte-identical when a link is refused.

Applying a hyperlink minted its relationship before the edit was allowed to happen, so a document open for viewing — and a scripted batch that was refused for an unrelated reason — kept the external target in its relationships even though no link was written. The target is now validated up front and the relationship is created only once the edit itself has been allowed, so a refusal leaves the file exactly as it was.
