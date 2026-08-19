---
'@docx-editor.dev/core': minor
---

Opening a review card no longer selects the change's text: the caret moves to the start of the range and the card's own highlight marks it, so the reader keeps whatever they had selected. Read `item.ranges` (revisions) or `item.range` (comments) for what a card is about, rather than the selection after `setActive`.
