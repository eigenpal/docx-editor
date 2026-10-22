---
'@docx-editor.dev/react': patch
'@docx-editor.dev/vue': patch
---

Fix toolbar popups staying open when the document surface cancels mouse events. Outside pointer presses now close the popup in React and Vue.
