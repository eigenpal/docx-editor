---
'@docx-editor.dev/react': patch
---

Hovering a tracked change in the page now raises a Word-style balloon with the author, what changed, when, and accept/reject where the change is resolvable. The balloon follows the pointer across changes, and clicking a change pins it until you press elsewhere. Tracked format changes mark their range with a quiet grey wash and dotted rule, tracked rows wear their insertion/deletion wash as a box, and rows carry their revision attribution in the painted DOM — so changes hidden from the review rail stay visible and one hover away.
