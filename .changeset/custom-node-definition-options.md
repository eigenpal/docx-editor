---
'@docx-editor.dev/pro': minor
---

`defineCustomNode` takes two new options. `schema` declares the shape of a node's payload as a zod (or any Standard Schema) schema, so it is checked once at the read boundary instead of by every caller. `preserveOnExport` declares what happens to the node when a document is exported outside the system that made it: `true` keeps it, `'text'` unwraps the control so a reader still sees the words while the tag, binding and payload go, and `false` removes it with its content.

Both describe intent today: the payload store landed before the write path that fills it, so a schema is validated for shape at definition time and neither option changes what is written yet.
