---
'@docx-editor.dev/core': major
---

`setSelection` now types the forms it actually accepts. `EditorSelection` gained the
`{ anchor, head }` paragraph-id pair the engine honours, and lost the `SemanticTarget` and
`DocLocation` arms it never accepted, so the outline and any other caller can move the caret
without a cast.

Breaking if you passed a `SemanticTarget` or a `DocLocation`-ended range to `setSelection`:
both were refused at runtime with `unsupported`, so working code is unaffected.
