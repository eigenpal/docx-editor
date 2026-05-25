---
'@eigenpal/docx-editor-core': patch
---

Numbered paragraphs whose direct `w:ind` has a first-line indent but no hanging slot (e.g. `<w:ind w:left="0" w:firstLine="720"/>`) now render the marker inline with the first body line at the firstLine position, matching Word/LibreOffice. Previously the painter wrapped the marker into a separate row above the text and the layout engine didn't reserve space for that row — the last line of the first fragment spilled below its container and the continuation fragment rendered on top of it (fixes #483).
