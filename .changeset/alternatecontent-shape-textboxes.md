---
'@eigenpal/docx-editor-core': patch
---

Extract WPS text-box drawings wrapped in `<mc:AlternateContent>` so floating text boxes from real Word docs (org-chart cards, callouts, etc.) round-trip through the parser instead of being silently dropped. The parser now walks both the direct `<w:drawing>` child of `<w:r>` and the `<mc:Choice>` / `<mc:Fallback>` branches of an `<mc:AlternateContent>` wrapper (preferring `Choice`).
