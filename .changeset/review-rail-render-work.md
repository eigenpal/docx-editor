---
'@docx-editor.dev/pro': patch
---

The review rail renders a card only when its own content or position changes, so scrolling and typing beside many comments and tracked changes stay responsive. A React `List` render prop or a Vue `#item` or default slot runs again for a card only when the item, the function, or the reactive state it reads changes, so if it reads a ref, a module variable, or a non-reactive variable, pass a new function or read the value with a hook or a reactive source inside the card.
