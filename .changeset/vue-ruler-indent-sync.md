---
'@eigenpal/docx-editor-vue': patch
---

Fix the Vue horizontal ruler indent handles not tracking the active paragraph. The ruler now reads the selection's left/right/first-line/hanging indents and tab stops (like React) and moves the handles to match. Also stop showing an extra first-line-indent marker at the left margin. Fixes #685
