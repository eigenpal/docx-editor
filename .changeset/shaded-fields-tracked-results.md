---
'@docx-editor.dev/core': patch
---

Tracked changes on a field's result now render as tracked. A deletion or insertion around the value of a cross-reference, page number or form field previously painted as ordinary unchanged text, so a reviewer saw no strikethrough or author colour on an edit the review sidebar was reporting correctly. `w:fldSimple` also paints its cached result instead of blank space, and field results now carry Word's grey field shading — always for legacy form fields unless the document sets `w:doNotShadeFormData`, and per the new `fieldShading` option (`never` / `when-selected` / `always`) for the rest.
