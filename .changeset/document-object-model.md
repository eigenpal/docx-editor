---
'@docx-editor.dev/agents': minor
---

Add the document object model to `@docx-editor.dev/agents/runtime`: `context.document` now reaches a real document. `document.body` reads the story's text, `body.paragraphs` (and `document.paragraphs`) list its paragraphs in reading order — table cell paragraphs included, nested tables included — and `body.search(text, options)` answers a range per occurrence, honouring `matchCase` and `matchWholeWord` and refusing an option it cannot honour instead of ignoring it. A range reads the text between its endpoints, knows the paragraphs it covers, and can be searched in turn. A paragraph reports its text and its identity, which comes from the document where the file wrote one.

Writes go through the same one-batch-or-nothing path: insert text at the start or end of a story, a paragraph or a range, replace what a range covers, delete it by replacing it with nothing, add a paragraph beside another one, split a paragraph on delimiters, clear or delete a paragraph. `range.select()` moves the reader's selection where there is a reader, and is refused with `NotSupported` on a document opened from bytes rather than silently doing nothing. Offsets are UTF-16 units everywhere, so a length that is read and an offset that is then written at mean the same positions.

The same script does the same thing whether it is driving bytes on a server or an editor a reader is looking at; selection is the one difference, and it is reported by `capabilities.selection`. Anything the document cannot honour — a write that would join paragraphs across a table cell, two changes claiming one paragraph, a paragraph a previous batch deleted, a decision made from a document that has since moved — is refused with a stable error code and leaves the document exactly as it was.

Headers, footers and notes are not reachable from this surface yet, and the paragraph collection is deliberately the main story's only: nothing flattens the other stories into it. Formatting (`font`, alignment, styles) and content controls arrive in a later release.
