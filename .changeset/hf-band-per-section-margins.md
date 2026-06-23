---
'@eigenpal/docx-editor-core': patch
---

Grow each section's header/footer band from that section's own margins. A section with thin margins (e.g. a landscape table section with a 0.5in bottom margin) embedded in a roomier 1in-margin body previously never grew its footer band, so the footer overlapped the footnote area and the page number rode up beside the last footnote instead of sitting below it. The overflow is now decided per margin set.
