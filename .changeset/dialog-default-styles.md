---
'@docx-editor.dev/core': patch
---

Give the packaged dialogs Word-like default styles with bordered inputs and visible buttons that survive host CSS resets such as Tailwind preflight. Popup parts rendered with `asChild` now forward behavior and geometry but not the packaged classes, so your own element keeps its styles.
