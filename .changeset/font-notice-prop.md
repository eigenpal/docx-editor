---
'@docx-editor.dev/react': minor
---

`<DocxEditor>` takes a `fontNotice` prop in React and Vue. Set it to `false` to remove the font substitution bar, or pass an object to restyle it. To show your own component in its place, pass `renderFontNotice` in React, fill the `#fontNotice` slot in Vue, or give `DocxEditor.FontNotice` a function as `children`.
