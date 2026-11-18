---
'@docx-editor.dev/pro': patch
---

The review rail renders a card only when its own content or position changes, so scrolling and typing beside many comments and tracked changes stay responsive. A card template (a React `List` render prop, or a Vue `#item` or default slot) runs again only when its item, its function, or the reactive state it reads changes.
