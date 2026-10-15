---
'@docx-editor.dev/core': minor
---

Make a review decision one undo step: pass one history group to `resolveAllReviewChanges`, tracked proposals, the comment and card methods, and the browser runtime's `run({ historyGroup }, callback)`, and one undo reverts them all. Typing over a selection that removes a note reference or a whole comment now undoes as one step.
