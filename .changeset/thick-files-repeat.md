---
'@eigenpal/docx-editor-core': patch
---

Fix Japanese/CJK IME input garbling text in suggesting mode. Composed text was re-inserted via `handleTextInput`, duplicating surrounding content and marking it as a tracked change. Suggesting mode now stays out of the way during composition and marks the committed text once it settles.
