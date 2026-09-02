## Why

Consumers need a server-first DOCX-to-PDF path that preserves the editor engine's physical
pagination instead of rebuilding document layout in a second renderer. The merged
`@docx-editor.dev/core/export` session now provides the shared semantic layout, admitted font
bytes, HarfBuzz glyph runs, document metadata, internal destinations, and validated image bytes
needed to test this path before its first public release.

## What Changes

- Add a private `@docx-editor.dev/docx-to-pdf` package over `@docx-editor.dev/core/export`.
- Add a one-shot `exportPdf` API for deterministic PDF generation from DOCX bytes.
- Use the shared font-backed export session for page geometry, font-resolution evidence, and layout
  records.
- Plan and encode a first vertical slice: physical pages, body/header/footer text spans, list
  markers, sanitized external links, and structured fidelity diagnostics.
- Keep PDFKit reshaping and built-in-font text as the current fidelity boundary until the writer
  port consumes Core's admitted font programs and HarfBuzz glyph runs.
- Defer reusable export sessions, table painting, image embedding, equation encoding, internal
  destinations, metadata dictionaries, and exact glyph placement to later tasks in this change.
- Return bounded typed failures and a structured result with PDF bytes, page count, font evidence,
  and nonfatal fidelity diagnostics.
- Add conformance fixtures that compare PDF geometry and extracted text with the shared semantic
  layout.
- Keep review markup controlled by Core's existing revision display mode. Defer PDF comments,
  annotations, tagged PDF, signatures, encryption, and forms until their contracts are specified.

## Capabilities

### New Capabilities

- `docx-to-pdf-export`: Server-first PDF generation from immutable Core semantic layouts, with
  deterministic pages, embedded resources, links, metadata, diagnostics, and bounded execution.

### Modified Capabilities

None.

## Impact

- Adds `packages/docx-to-pdf/` and its package build, tests, API snapshot, notices, and release
  wiring.
- Consumes `@docx-editor.dev/core/export`, `@docx-editor.dev/core/layout`, and
  `@docx-editor.dev/fonts` as the sole document, layout, and font authorities.
- Adds one PDF writer dependency after license, browser-bundle, font-embedding, image, and
  deterministic-output evaluation.
- May expose exporter-neutral wiring gaps in the PDF translator. Such findings will be reported in
  this change and will not block Core contract work that has already landed.
