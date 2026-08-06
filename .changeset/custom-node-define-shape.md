---
'@docx-editor.dev/pro': minor
---

Defining a custom node is an identity, a shape and what the document shows: `defineCustomNode({ name, tagPrefix, schema, text })`. `text` replaces the `toDocx` hook that returned an attrs-and-text pair, and `tagAttrs` covers the rarer case of putting identity in the `w:tag` as well. `defineCustomNode` returns a `CustomNode` carrying `dataOf`, which narrows a node to that definition and validates its payload against that definition's schema — so a host reads a typed value from the chip, the review rail or its own state without writing a parse at the call site.
