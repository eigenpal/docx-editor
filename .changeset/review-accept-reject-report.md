---
'@docx-editor.dev/pro': minor
---

`useReview().accept` and `.reject` now report whether the resolution landed, like `remove` and `reply` already did. `readOnly` is not the only way the engine refuses one — a document open for viewing refuses every one — and swallowing the result left hosts rendering live buttons that did nothing when clicked.
