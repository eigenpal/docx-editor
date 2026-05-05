---
'@eigenpal/docx-js-editor': patch
---

Unify header/footer rendering with the body pipeline. Header tables now render in the normal paginated view (previously they were silently dropped on the paginated render path while showing in edit mode), and headers/footers gain full block-kind support — paragraphs, tables, images, text boxes, and PAGE/NUMPAGES fields — by routing through the same `headerFooterToProseDoc → buildBoxTree → measureBlocks → paintFragment` chain the body uses. Fixes #356, #357, #358.
