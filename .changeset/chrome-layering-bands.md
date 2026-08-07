---
'@docx-editor.dev/core': patch
---

Menus and popovers now paint above the editor's own furniture. Toolbar dropdowns, the menu bar, colour pickers and the hyperlink popover sat at a lower z-index than the navigation gutter and table chrome, so opening File put the menu underneath the navigation toggle. Layering is now three `--doc-z-*` tokens (`chrome`, `overlay`, `context`) rather than a dozen hand-picked numbers.
