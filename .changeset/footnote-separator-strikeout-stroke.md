---
'@docx-editor.dev/core': patch
---

The footnote separator rule now takes its thickness and its offset above the baseline from the run font's strikeout metrics, matching how Word paints `w:separator`.
