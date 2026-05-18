---
'@eigenpal/docx-editor-core': patch
---

Internal refactor: TableExtension closure split into per-domain modules under `prosemirror/extensions/nodes/TableExtension/commands/` (insert, delete, selection, borders, cellFormatting, sizing, tableStyle, helpers, activeCellPlugin). Schema-binding commands become `make*(schema)` factories called once per editor; schema-free commands become module-level `Command` constants. No public API change.
