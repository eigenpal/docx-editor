---
'@eigenpal/docx-editor-react': minor
'@eigenpal/docx-editor-vue': minor
---

Add a `colorMode` prop (`'light' | 'dark' | 'system'`) for native dark mode. Dark mode re-themes the editor chrome through the shared design tokens and renders the document canvas like Word's dark view: a dark page with light text where authored colours are lightness-inverted (hue preserved) for legibility. It is a display transform only; the saved DOCX is unchanged. `'system'` follows the OS `prefers-color-scheme`.
