---
'@docx-editor.dev/core': patch
---

Keep floating drawings whose anchor flags are spelled with surrounding whitespace. `behindDoc`, `locked`, `layoutInCell`, `allowOverlap`, `simplePos` and `hidden` are `xsd:boolean`, which carries a fixed `whiteSpace="collapse"` facet, so `1` and `true\n` are legal — the anchor gate compared the raw string and dropped the drawing instead. Schema-invalid spellings such as `yes` or `2` are still refused.
