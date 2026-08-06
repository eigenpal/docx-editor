---
'@docx-editor.dev/core': patch
---

Anchored text boxes now render their content clipped inside the shape's extent in the body, headers, and footers, with PAGE / NUMPAGES / SECTIONPAGES fields inside header/footer text boxes evaluated per page. Editing a header or footer whose direct content is nearly empty now shows a full-height edit band instead of a hairline.
