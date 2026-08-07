---
'@docx-editor.dev/core': patch
---

The collapsed review rail now draws a glyph for what each marker actually is — an insertion, a deletion, a formatting change, a comment or a custom node — instead of one comment bubble for every kind. A custom node names its own through `reviewCard`'s new `icon`, and the `Markers` part takes an `icon` of its own for a host that wants to draw all of them itself.
