---
'@docx-editor.dev/core': minor
---

Accepting and rejecting tracked changes now resolves formatting with its paragraph mark, nested changes, table and list changes, moves, content controls, fields, equations, and comment text as one decision, and counts changes the same way in every list. A change that stays pending reports why through the `reviewChangesResolved` event, `reviewCodeOfSkip`, and the new `review.locked-content` and `review.bound-content` codes. Fixes #1458, fixes #1459, fixes #1460
