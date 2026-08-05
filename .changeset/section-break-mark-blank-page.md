---
'@docx-editor.dev/react': patch
---

Stop an empty paragraph that carries a section break from producing a blank page. The paragraph mark holding a `w:sectPr` is the section break itself, so when it paints nothing it now stays on the page its section ended on instead of opening a sheet the following next-page section then leaves empty.
