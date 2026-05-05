---
'@eigenpal/docx-js-editor': patch
---

Fix list numbering when multiple `<w:num>` elements share one `<w:abstractNum>`. Per ECMA-376 §17.9.18 they share counter state and a `<w:lvlOverride>/<w:startOverride>` only resets the shared counter the first time its numId appears. Counter state is now keyed by abstractNumId; first-encounter resets are honored. Also fixes a related justification bug where list-level indents written with `<w:ind w:start="0"/>` were ignored, causing a 720-twip fallback indent to be applied and table-cell text to render 48px short of the cell width.
