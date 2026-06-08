---
'@eigenpal/docx-editor-core': patch
---

Fix header content overlapping the body when a header contains a floating text box (e.g. a centered banner). The floating box is now positioned without pushing the in-flow header paragraphs below it — so a centered banner sits beside the surrounding header text and the body no longer overlaps the header on multi-page documents. Inline and top-and-bottom boxes still reserve vertical space.
