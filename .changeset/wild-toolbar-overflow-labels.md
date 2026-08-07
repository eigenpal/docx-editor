---
'@docx-editor.dev/react': minor
---

Localizing the editor now works the way the docs describe it. `<DocxEditor>` takes an `i18n` prop, so a locale no longer needs a `LocaleProvider` around it; a provider still works and now composes when nested instead of resetting the subtree to English. The toolbar's overflow panel also labels its value rows (zoom, line spacing, the style, font and colour pickers) from the active catalogue rather than showing the raw i18n key.
