---
'@docx-editor.dev/core': patch
---

Header and footer variants resolve per page, so a title page with no first-page header starts its body at the top margin, and a sheet added for note overflow takes the variant its own page number resolves. `PAGE` and `NUMPAGES` fields evaluate the `\#` numeric picture switch instead of painting the result cached in the file.
