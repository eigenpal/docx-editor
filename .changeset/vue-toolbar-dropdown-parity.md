---
'@eigenpal/docx-editor-vue': patch
---

Bring the Vue toolbar's visual styling closer to React: toolbar controls now use the inherited system font (instead of the browser default Arial), the dropdown menus match React's border/radius/shadow, and the style-picker dropdown no longer balloons in width (the per-style preview is applied to an inner span and the menu is width-capped). Also extracts the font-size and style-option logic into composables to keep Toolbar.vue maintainable.
