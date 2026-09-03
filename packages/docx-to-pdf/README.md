# `@docx-editor.dev/docx-to-pdf`

> Private workspace package. Publishing is intentionally deferred to the final release step.

Licensed under the **EigenPal Pro License** — see [LICENSE.md](./LICENSE.md). Production use
requires a commercial agreement: licensing@eigenpal.com.

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
- Body, header, and footer text spans and list markers at semantic geometry, including table cell
  text flow.
- Sanitized external and internal link annotations over span boxes.
- Named internal destinations from Core-published geometry.
- Bounded document metadata in the PDF information dictionary.
- Structured fidelity diagnostics for every unsupported or approximated record.
- Typed open, resource, fidelity, and paint-validation failures.

### Fidelity boundary

`exportPdf` preserves admitted-face aliases while sharing one bounded byte copy per resource
identity. When Core admits a matching standalone sfnt face and the PDF layer accepts its OS/2
`fsType`, the PDFKit writer registers the exact admitted bytes. The PDF layer refuses every TTC/OTC
collection container (`ttcf`), including `faceIndex` 0, because a verifiable collection face selector
is unavailable. It also parses admitted sfnt OS/2 `fsType` and refuses restricted-license embedding
(`0x0002`) and no-subsetting faces (`0x0100`) because PDFKit has no safe full-font embedding mode.
Refused spans fall back to PDF built-in fonts only when the span text is WinAnsi-representable.
Otherwise the writer omits the span and records a `standard-font-encoding` unsupported diagnostic.

PDFKit still reshapes Unicode through fontkit and does not encode Core HarfBuzz glyph IDs or
positions. Every painted text span records a truthful `shaped-glyph-run` approximation diagnostic,
whether the span used embedded bytes or a built-in font. Non-exact built-in fallback also records
`standard-font-substitution`. Strict export refuses those documents.

Core still enforces admission-time permissions: `availability: 'forbidden'` faces and
document-embedded faces dropped as `overLimit` or `malformed` never reach the writer.

Exact HarfBuzz glyph placement, table structure and decoration, images, equations, inline and
anchored drawings, paragraph decoration, tab leaders, note areas, and reusable export sessions
remain deferred. The planner emits bounded diagnostics instead of silently omitting unsupported
records.

```ts
import { exportPdf } from '@docx-editor.dev/docx-to-pdf';

const result = await exportPdf(docxBytes);
result.bytes; // Uint8Array PDF
result.pageCount;
result.diagnostics;
```

The package is private in this change and cannot be installed from the public registry yet.
Inside this monorepo, depend on it with `workspace:*`.
