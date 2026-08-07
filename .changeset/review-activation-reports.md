---
'@docx-editor.dev/core': minor
---

Activating a review card now reports whether it landed. `setActiveReviewItem` returns an `ExecResult` and `useReview().setActive` a boolean, so a host walking the queue with next/previous controls can tell a step that did nothing from one that worked — activation is refused for an unknown key, an item with no range, a story that will not open, and a revision kind the rail excluded. Review items carry a matching `activatable` flag, so a card that cannot be clicked can be drawn that way instead of discovering it on click.
