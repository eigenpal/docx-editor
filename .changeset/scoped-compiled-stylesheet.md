---
'@docx-editor.dev/core': minor
'@docx-editor.dev/react': minor
---

The shipped stylesheet is now precompiled and fully namespaced: every Tailwind utility, editable-surface rule and keyframe is scoped under the renamed `.docx-editor` root class (previously `.ep-root`), so the CSS no longer collides with a host app's Tailwind setup and styles the chrome correctly in hosts without Tailwind. If your own CSS targets `.ep-root`, switch it to `.docx-editor`.
