---
'@docx-editor.dev/core': major
'@docx-editor.dev/react': major
---

The shipped stylesheet is now precompiled and fully namespaced: every Tailwind utility, editable-surface rule and keyframe is scoped under the renamed `.docx-editor` root class (previously `.ep-root`), so the CSS no longer collides with a host app's Tailwind setup and styles the chrome correctly in hosts without Tailwind. Breaking: consumer CSS targeting `.ep-root` must switch to `.docx-editor`.
