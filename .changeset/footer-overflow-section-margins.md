---
'@eigenpal/docx-js-editor': patch
---

Fix footer overflowing into body content on documents with tracked-change footers (or any footer taller than the authored bottom margin). The auto-extend that pushes body content up to make room for an oversized footer was applied to the document-level fallback margins but not to per-section margins carried on section breaks. The layout engine prefers section-break margins, so the extension was getting overridden and the footer rendered on top of body text. Section-break and final-section margins now also extend.
