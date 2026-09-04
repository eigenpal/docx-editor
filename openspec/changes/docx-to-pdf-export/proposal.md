## Why

Consumers need a server-first DOCX-to-PDF path that preserves the editor engine's physical
pagination instead of rebuilding document layout in a second renderer. The merged
`@docx-editor.dev/core/export` session now provides the shared semantic layout, admitted font
bytes, HarfBuzz glyph runs, document metadata, internal destinations, and validated image bytes
needed to test this path before its first public release.

## What Changes

This pull request lands a **private first slice** only. It does not claim MVP or publication
readiness.

- Add a private `@docx-editor.dev/docx-to-pdf` package over `@docx-editor.dev/core/export` under
  the EigenPal Pro License.
- Add a one-shot `exportPdf` API for PDF generation from DOCX bytes.
- Encode the private first slice boundary exactly:
  - **In scope:** physical page boxes; body, header, and footer text spans and list markers at
    Core semantic geometry (including table cell text flow); published paragraph and cell shading
    fills; published paragraph borders at Core edge boxes; insert/delete revision presentation when
    PDF text commands can encode it; sanitized
    external and internal link annotations; named internal destinations; bounded document metadata;
    structured fidelity diagnostics; strict refusal when visible approximations or unsupported
    records exist.
  - **Font behavior in this slice:** `exportPdf` preserves admitted-face aliases while sharing one
    bounded byte copy per resource identity. When Core admits a matching face and the PDF layer
    accepts its sfnt OS/2 `fsType` and `faceIndex`, the PDFKit writer registers the exact admitted
    bytes; otherwise it falls back to PDF built-in fonts when WinAnsi can represent the span text.
    TTC/OTC collections are accepted when the writer can parse the collection header, select the
    `faceIndex` SFNT directory, verify that face's OS/2 `fsType`, and pass the selected PostScript
    name to PDFKit. Malformed collections and out-of-range indices are refused. Restricted,
    no-subsetting, and bitmap-only OS/2 `fsType` faces are refused.
    Embedded spans with missing cmap coverage are omitted and record `font-cmap-coverage`.
    WinAnsi-unsafe fallback text is omitted and records a `standard-font-encoding` diagnostic that
    names the selected built-in font and requested family. PDFKit still reshapes Unicode through
    fontkit and does not encode Core HarfBuzz glyph IDs. Every painted text span records a truthful
    `shaped-glyph-run` approximation diagnostic; non-exact built-in fallback also records
    `standard-font-substitution`.
  - **Deferred:** exact HarfBuzz glyph placement; table structure and borders (cell text and
    published cell shading still paint with a `table` diagnostic); images; equations; inline and
    anchored drawings; tab leaders and note areas; comment balloons and
    review-range PDF annotations; reusable export sessions. Default `all-markup` does not paint
    proposed and deleted text identically without a diagnostic.
- Remove Core's unused `pdf-lib` optional peer now that PDF export lives in
  `@docx-editor.dev/docx-to-pdf`.
- Return bounded typed failures and a structured result with PDF bytes, page count, font evidence,
  and nonfatal fidelity diagnostics.

## Capabilities

### New Capabilities

- `docx-to-pdf-export`: Private first slice for server-first PDF generation from immutable Core
  semantic layouts, with deterministic page boxes, text-span painting, links, metadata, diagnostics,
  and bounded execution.

### Modified Capabilities

None.

## Impact

- Adds `packages/docx-to-pdf/` with EigenPal Pro License metadata, build, tests, API snapshot,
  notices, and private release wiring.
- Consumes `@docx-editor.dev/core/export`, `@docx-editor.dev/core/layout`, and
  `@docx-editor.dev/fonts` as the sole document, layout, and font authorities.
- Adds PDFKit as the first PDF writer dependency after license, bundle-size, and deterministic-output
  evaluation.
- Removes the unused `pdf-lib` optional peer from `@docx-editor.dev/core`.
- May expose exporter-neutral wiring gaps in the PDF translator. Such findings will be reported in
  this change and will not block Core contract work that has already landed.
