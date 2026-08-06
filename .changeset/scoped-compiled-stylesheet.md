---
'@docx-editor.dev/core': major
---

The shipped stylesheet is now precompiled and fully namespaced: every Tailwind utility and editable-surface rule is scoped under the renamed `.docx-editor` root class (previously `.ep-root`), so the CSS no longer collides with a host app's Tailwind setup and styles chrome correctly in hosts without Tailwind. Breaking: consumer CSS targeting `.ep-root` must switch to `.docx-editor`.
