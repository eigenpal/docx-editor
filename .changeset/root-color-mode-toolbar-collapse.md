---
'@docx-editor.dev/react': minor
---

Composed editors accept `colorMode` on the root, with `useEditorColorMode()` and `useScopeClassName()` reporting the theme to your own parts, and the toolbar moves controls into the `⋯` panel one at a time instead of whole groups. Each toolbar control now sits in a `.docx-toolbar__item` element, so host CSS for direct children of `.docx-toolbar__group` needs that level added. Fixes #1613. Fixes #1614.
