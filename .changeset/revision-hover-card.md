---
'@docx-editor.dev/react': patch
---

Hovering a tracked change in the page now raises a Word-style balloon with the author, what changed, when, and accept/reject where the change is resolvable. Tracked table rows carry their revision attribution in the painted DOM, so structural changes hidden from the review rail stay one hover away.
