---
'@eigenpal/docx-editor-vue': patch
---

Fix the Vue "Add comment" card overlapping existing comment and tracked-change cards in the sidebar. The add-comment input now flows through the same collision-avoidance pass as every other card, so it claims its slot and neighbouring cards stack below it. Fixes #669
