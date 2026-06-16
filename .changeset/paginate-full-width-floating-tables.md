---
'@eigenpal/docx-editor-core': patch
---

Full-width floating (positioned) tables now paginate across pages instead of overflowing past the bottom margin. Previously such a table — common in contract templates where a full-width form table carries text-wrap positioning — rendered as one oversized block that bled past the page edge, left the next page blank, and pushed following content down. It now breaks across pages like Word and Google Docs, with the text after it flowing immediately below.
