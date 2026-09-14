---
'@docx-editor.dev/core': patch
---

Give the packaged dialogs Word-like default styles with bordered inputs and visible buttons that survive host CSS resets such as Tailwind preflight. Dialog parts rendered with `asChild` no longer receive the packaged classes, so your own button styles apply as written.
