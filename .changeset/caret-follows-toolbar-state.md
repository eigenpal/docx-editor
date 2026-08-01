---
'@docx-editor.dev/core': patch
---

Toolbar controls now update when the caret moves. `snapshot().selection` is deliberately null, so two paragraphs with the same formatting derived a value-equal snapshot and a host subscribed through `useSyncExternalStore` never re-rendered on a caret move. Every control whose enabled state is a question about the caret kept its previous answer: Decrease Indent stayed live on a list item already at the outermost level, and the bullet button stayed pressed after the caret moved into a numbered list.

List markers sit on their first line's baseline. Painting the glyph into its own block let it inherit that block's default line-height at the marker's font size, so a number landed below the text it numbers and a bullet floated above it.
