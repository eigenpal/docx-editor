---
'@eigenpal/docx-editor-vue': patch
---

Fix the Vue header/footer "Remove" button doing nothing. Removing a header or footer now drops the part from the package and strips its section references, so it stops rendering on the page (matching React). Fixes #686
