---
'@docx-editor.dev/core': patch
---

Jumping to a tracked change or a selection now lands on it: the reveal was measuring caret geometry against the top of the sheet rather than the page's content box, so every jump stopped one page margin short and left the target just under the fold. Reveals that have to travel now centre their target instead of stopping the moment it clears the bottom edge, and one that is already on screen still does not move.
