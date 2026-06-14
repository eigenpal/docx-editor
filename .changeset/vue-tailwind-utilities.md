---
'@eigenpal/docx-editor-vue': patch
---

Ship Tailwind utility classes in the Vue package's `styles.css`. The Vue build now runs Tailwind (via its own `tailwind.config.js` + PostCSS), so utility classes used by components like `Button` and `Toolbar` are styled out of the box for consumers who import `@eigenpal/docx-editor-vue/styles.css`, without needing their own Tailwind config. Fixes #594.
