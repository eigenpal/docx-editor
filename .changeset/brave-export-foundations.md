---
'@docx-editor.dev/core': minor
---

Add the DOM-free `@docx-editor.dev/core/export` session with immutable export-ready semantic
layouts and shared shaping and resource settlement. Exporters consume the same layout
coordinator and semantic records as the browser engine, including page-scoped, exporter-neutral
comment and tracked-change provenance that future Markdown, PDF, and other exporters can bind to
their own output coordinates. Document-aware font-backed sessions also retain immutable resolution
evidence so every exporter can report the exact direct, substituted, incomplete, and failed font
origins behind pagination.
