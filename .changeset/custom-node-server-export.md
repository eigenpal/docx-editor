---
'@docx-editor.dev/pro': patch
---

`exportCustomNodes` now strips every payload store for a namespace rather than the first, so a document whose nodes were authored server-side with `customNodeXml` — which writes one store per call — no longer ships the payloads of nodes it removed.
