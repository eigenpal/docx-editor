---
'@docx-editor.dev/core': minor
---

Review navigation now goes where it says it does: activating a card selects the item's whole range and scrolls to it even when your own UI holds focus or the target page is not yet materialized, walking from a header change back to a body change leaves the header story so the body card activates again, and the `setSelection` command reveals its target. New `setReviewActivationExclusions` lets a host rail tell the engine which revision kinds it hides, so clicking tracked text never opens a card the rail does not render.
