---
'@eigenpal/docx-editor-core': patch
---

Render text boxes in headers and footers. Headers and footers now flow through the same block-content parser as the document body, so text boxes (and bullet-glyph conversion) are parsed everywhere a Word user can place them. The header/footer page painter also now draws `textBox` and `image` blocks, which it previously measured but never painted — so a header/footer text box that only appeared in the inline editor now also shows in the page view.
