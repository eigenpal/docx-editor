---
'@docx-editor.dev/pro': patch
---

Fixes four ways a write could lose data. `text` and `tagAttrs` now derive from the schema's output rather than the caller's argument, so a `.default()` or `.transform()` no longer writes a document describing a value it does not hold; a hook that throws is a typed refusal instead of an exception; `updateCustomNode` carries the tag attrs, the alias and the lock forward when they are not mentioned, and refuses a node belonging to another definition rather than converting it; and `prepareForExport` unwraps every story before cleaning up stores, so a chip in a header no longer ships the payload it was asked to strip.
