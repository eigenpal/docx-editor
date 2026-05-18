---
'@eigenpal/docx-editor-core': minor
---

`@eigenpal/docx-editor-core` now ships an API Extractor snapshot for every published subpath (61 entries) under `packages/core/etc/`. CI fails on any undocumented drift to the public surface via `bun run api:check`. Adds rich TSDoc on the 21 most-imported types — `Document`, `DocumentBody`, `Paragraph`, `Run`, `Table`, `TableRow`, `TableCell`, `Image`, `Hyperlink`, `Comment`, `ColorValue`, `BorderSpec`, `ShadingProperties`, `TextFormatting`, `ParagraphFormatting`, `Style`, `Section`, `SectionProperties`, `ListLevel`, `ListRendering`, `AbstractNumbering`, `NumberingDefinitions` — each linked to its ECMA-376 reference.

No runtime change; doc-only.
