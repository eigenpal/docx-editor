---
'@docx-editor.dev/react': patch
---

`<DocxEditor>` takes a `fontNotice` prop in React and Vue: `false` removes the font substitution bar, and an object restyles it. To show your own component in its place, pass `renderFontNotice` in React or fill the `#fontNotice` slot in Vue.
