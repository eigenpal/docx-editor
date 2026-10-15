---
'@docx-editor.dev/editor-api': minor
---

Add `Paragraph.search()`, and load collection items with their properties in one sync through `items/<property>` paths such as `paragraphs.load('items/text')`. Using a held object that the document no longer contains now reports `edit.stale-target` in `debugInfo.innerError`, and removed-object refusals report that diagnostic in editor diagnostics and telemetry too.
