---
'@docx-editor.dev/agents': patch
---

Add the engine-side document automation host the object model is built on: a transport-neutral batch protocol with opaque document handles, available both over an editor that is already open and headlessly over DOCX bytes, with every write going through the editor's own transaction so a scripted edit is undoable and atomic like a typed one. No public API changes in this release.
