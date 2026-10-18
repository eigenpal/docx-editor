---
'@docx-editor.dev/core': minor
---

`@docx-editor.dev/core/parse` reads a document ahead of its open, on any thread. `parseDocument(bytes)` runs the open's own bounded package read and answers a `ParsedDocument` that crosses `postMessage` (`parsedDocumentTransferables` lists the buffers to move), so a Web Worker can do the unzip and the XML while the page stays responsive. `createDocxEditor({ document })`, `load()` and an adapter's `document` prop accept it: the open skips the read and goes straight to fonts and the first layout, on exactly the model the bytes give, with the same pages and the same `save()`. `receiveParsedDocument` rebuilds the read on the receiving thread in one task and `receiveParsedDocumentInSlices` in short ones; the editor does it on open if neither has run.
