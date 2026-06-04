---
'@eigenpal/docx-editor-core': patch
---

Stop squashing anchored images that sit near the right edge of the page. A floating image positioned so its width reaches into the page margin (e.g. a logo flush to the top-right) was being capped to the remaining content width by the global `img { max-width: 100% }` reset and then stretched against its fixed height. Painted floating images now keep their exact OOXML size.
