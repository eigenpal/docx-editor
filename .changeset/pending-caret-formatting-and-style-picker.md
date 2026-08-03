---
'@docx-editor.dev/react': minor
---

Formatting now works at a collapsed caret the way Word's does. Pressing Bold (or italic, underline, strikethrough, a font, a size, a color) with nothing selected arms the format for the next characters typed there, and the toolbar reflects the press immediately. The armed format follows Word's typing-format rules: it survives Backspace, Delete, Enter, Shift+Enter and Tab, applies to typed text, pasted plain text and IME-composed text alike, keeps the face it was armed with, and is discarded when the caret moves away or the document is undone. This also makes an empty paragraph stylable before you type into it.

The style dropdown is live: it lists the document's paragraph styles, shows the selection's current style, and applies a pick to every paragraph the selection touches via the new `setParagraphStyle` command. React adds the `ParagraphStyle` compound part and the `useParagraphStyle` hook, and the control greys out with the engine's reason on documents that define no paragraph styles.
