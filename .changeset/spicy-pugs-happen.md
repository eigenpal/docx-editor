---
'@docx-editor.dev/core': patch
---

Speed up typing and document open on large multi-section documents: per-keystroke layout no longer re-derives whole-document indexes (section enumeration, content-control tokens and boundaries, footnote reference maps), and the footnote reserve reflow no longer forces a second full pagination pass at open.
