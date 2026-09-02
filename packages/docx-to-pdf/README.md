# `@docx-editor.dev/docx-to-pdf`

> Private workspace package. Publishing is intentionally deferred to the final release step.

Server-first DOCX-to-PDF conversion powered by the same semantic layout engine as the browser
editor. It requires no DOM, browser print automation, or operating-system printer drivers.

The final release step must replace this private banner and workspace demo quick start with public
installation and usage instructions, remove the package from Changesets `ignore`, choose the public
version, align the `@docx-editor.dev/core` and `@docx-editor.dev/fonts` version floors with that
release, and only then remove `private: true`. Repository tests intentionally reject a partial
release state.

## Current scope

The public Node API is a one-shot `exportPdf(source, options?)` call. It opens Core with
`openFontBackedDocumentForExport`, lays out once, plans paint commands, and encodes PDF bytes with
an internal PDFKit writer. Reusable export sessions are not published yet.

Default `displayMode` is Core's `all-markup`. Default `fidelityPolicy` is `best-effort`. Strict
policy throws `PdfFidelityError` when any visible approximation or unsupported diagnostic exists.

### What Core already provides

Core's font-backed export session publishes the same records other exporters use:

- **Admitted font bytes** through `admittedFontFace`, including packaged, caller, substituted, and
  document-embedded faces.
- **Exact HarfBuzz shaping** through `shapeLaidOutText` on the same spans measurement used.
- **Document metadata** and **internal destination geometry** on each `ExportSemanticLayout`.
- **Validated image bytes** through `validatedImageBytes` while the session is open.

### What this slice implements

- Physical page boxes sized from Core pagination.
- Body, header, and footer text spans and list markers at semantic geometry.
- Sanitized external and internal link annotations over span boxes.
- Bounded document metadata in the PDF information dictionary.
- Structured fidelity diagnostics for every unsupported or approximated record.
- Typed open, resource, fidelity, and paint-validation failures.

### Fidelity boundary

The current PDFKit writer does not consume Core's admitted font programs or HarfBuzz glyph runs.
PDFKit reshapes Unicode through its built-in fonts and fontkit. Text export is therefore a labeled
best-effort approximation, not exact glyph placement. Every export that paints text records a
`shaped-glyph-run` approximation diagnostic. Strict export refuses those documents.

Tables, images, equations, inline and anchored drawings, paragraph decoration, tab leaders,
and note areas are not painted in this slice. The planner emits bounded diagnostics instead of
silently omitting them.

```ts
import { exportPdf } from '@docx-editor.dev/docx-to-pdf';

const result = await exportPdf(docxBytes);
result.bytes; // Uint8Array PDF
result.pageCount;
result.diagnostics;
```

The package is private in this change and cannot be installed from the public registry yet.
Inside this monorepo, depend on it with `workspace:*`.
