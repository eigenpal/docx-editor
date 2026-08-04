---
'@docx-editor.dev/agents': minor
---

Add `@docx-editor.dev/agents/runtime`, a batching document automation runtime. Work is described against proxy objects and nothing reaches the document until `await context.sync()`, which sends one ordered batch and either applies all of it or none of it; reading a property that was not asked for is an error rather than a silent `undefined`. `DocxEditor.createServer(bytes)` opens DOCX bytes and can save them back; `DocxEditor.createBrowser(editor)`, from the `runtime/browser` subpath, drives an editor that is already open and leaves its lifetime, undo history and caret to the editor. Proxies stop being valid when the run that created them ends unless `context.trackedObjects` is told to keep them, and every refusal carries a stable error code. Handing a kept object to another run waits for the run that owns it to finish, and the writes that follow are conditional on the revision its state was read at, so a decision made from a document that has since moved is refused rather than applied at the wrong place.

Document objects — paragraphs, tables, ranges — arrive in a later release; this is the lifecycle they are built on.
