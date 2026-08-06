---
'@docx-editor.dev/react': minor
---

Composed chrome is legible and styled with zero configuration. Bare `DocxEditor.Toolbar`, `DocxEditor.Menu`, and `DocxEditor.ContextMenu` now resolve labels through the active locale catalogue (so `LocaleProvider` localizes them) instead of rendering raw i18n keys, and emit the `docx-editor` styling scope on their own root — matching `DocxEditor.Loading` — so they render styled wherever the host mounts them. New `useChromeTranslate(overrides?)` returns a catalogue-backed resolver assignable to every part's `t` prop, with a `Map` of key-level overrides consulted first. The `<DocxEditor>` `t` prop now also receives interpolation params, so host resolvers can format parameterized labels like the navigation match counter.
