---
'@docx-editor.dev/react': patch
---

Continuous section breaks now continue on the page before them, the way Word renders them, instead of starting a new page. A continuous break that also changes the paper size still starts a new page, as it does in Word.

Different even and odd headers are now chosen by the page's number in the document, so the alternation carries across section breaks instead of restarting at each one.

Insert a hard page break with `insertBreak` and `kind: 'page'`; it previously inserted a line break.

Paragraph shading now paints when the document states a resolved colour next to a theme reference, which is what Word writes for accent shading.

`w:spacing` is merged attribute by attribute across the style cascade, so a style that sets only the space before no longer clears an inherited space after.
