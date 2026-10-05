---
'@docx-editor.dev/core': patch
---

PAGE, NUMPAGES, and SECTIONPAGES fields with the Arabic, roman, alphabetic, or ArabicDash format switch now show the computed value on each page instead of the saved result. A numeric picture switch now applies in sections with a roman or alphabetic page-number format, and alphabetic page numbers past 26 repeat one letter. Fixes #1110
