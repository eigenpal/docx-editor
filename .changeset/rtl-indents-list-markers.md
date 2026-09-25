---
'@docx-editor.dev/core': patch
---

Right-to-left paragraphs now take `w:left` indents from the right margin, place list markers on the right in right-to-left order, and number `hebrew1`, `hebrew2`, `arabicAlpha`, `arabicAbjad`, and `hindiNumbers` lists in their own scripts. For these paragraphs, `formatting.indent` reports the `w:left` value as `left` and sets `rtl`, and the ruler mirrors its indent handles.
