## Context

The merged `@docx-editor.dev/core/export` entry point publishes recursively immutable
`ExportSemanticLayout` snapshots from the same layout coordinator used by the editor. It settles
images, supports document-aware font-backed measurement, exposes validated image bytes, and
publishes review and font-resolution evidence.

Core now also publishes the exporter-neutral records a PDF writer needs:

- **Admitted font programs** through `admittedFontFace`, including packaged, caller, substituted,
  and document-embedded faces.
- **Exact HarfBuzz glyph runs** through `shapeLaidOutText` on the same spans measurement used.
- **Bounded document metadata** and **internal destination geometry** on each layout snapshot.
- **Document-embedded font admission** in Node export after explicit origins, matching the browser
  editor.

The PDF exporter must translate those records into PDF operators. It must not parse OOXML, use
browser print, or run a second pagination pipeline. The first implementation remains private while
the export contract and PDF fidelity are validated.

The current fidelity boundary is PDFKit integration, not missing Core contracts:

- PDFKit's public text API always reshapes Unicode through fontkit and cannot accept an external
  HarfBuzz glyph run.
- The first vertical slice therefore maps semantic styles to PDF built-in fonts and records a
  `shaped-glyph-run` approximation for every painted text span.
- Strict export refuses visible approximations until the writer port embeds admitted font programs
  and encodes Core glyph positions.
- Validated image bytes must still be copied before session disposal. EMF, WMF, and TIFF also
  require a host converter.
- Review occurrences expose source ranges but no page rectangles for PDF annotations.
- Core still declares unused `pdf-lib` as an optional peer, while the browser dependency proof in
  task 10.7 of `typed-ooxml-paragraph-editor` remains open.

## Goals / Non-Goals

**Goals:**

- Prove that an immutable Core layout can drive valid multi-page PDF output.
- Preserve Core page geometry, stacking, clipping, text baselines, images, links, and revision
  display modes.
- Wire Core's admitted font programs and HarfBuzz glyph runs into the PDF writer when strict text
  fidelity is required.
- Provide strict and best-effort fidelity policies with structured diagnostics.
- Keep Node as the first supported runtime and keep the package private during validation.
- Make output deterministic and bounded for untrusted DOCX input.

**Non-Goals:**

- Reparse OOXML or duplicate style, field, table, drawing, or pagination logic.
- Use Chromium, a DOM screenshot, CSS print, or operating-system printer drivers.
- Publish the package before representative Word-fidelity fixtures pass.
- Add tagged PDF, PDF/A, digital signatures, encryption, AcroForm fields, or editable review
  annotations in the first version.
- Claim tables, images, equations, reusable sessions, or exact glyph placement are complete before
  their tasks land.

## Decisions

### Add a thin `@docx-editor.dev/docx-to-pdf` translator

The package mirrors the Markdown package's one-shot shape first. It owns PDF types, PDF encoding,
diagnostics, and default font provisioning. Core remains the only document and layout authority. A
reusable session API stays deferred until the one-shot slice is stable.

Alternative: add PDF methods to Core. Rejected because binary format encoding and its dependency do
not belong in the engine.

### Start with a direct PDF writer

The first spike evaluates `pdfkit@0.20.x` behind a narrow internal writer port. PDFKit supports
Node, vector operators, links, images, current `fontkit`, font embedding, and subsetting. Its public
text API always reshapes Unicode through fontkit and cannot accept an external HarfBuzz glyph run.
The port therefore isolates document creation, page operators, resources, annotations, and final
byte collection. PDFKit text remains best-effort only in the current slice.

Alternative: `pdf-lib`. Rejected for the first spike because it uses an older fontkit integration
and does not provide a complete complex-script shaping path.

Alternative: browser print. Rejected because it introduces a second layout engine, a large runtime,
platform differences, and HTML security concerns.

The dependency decision remains reversible until the spike proves text placement, font subsetting,
image reuse, and deterministic output.

PDFKit can produce repeatable Node bytes when creation metadata is fixed and encryption is disabled.
Node and browser compression produce different byte streams. Cross-runtime byte identity therefore
requires disabled compression or one shared compressor.

The initial spike uses `pdfkit@0.20.1`, which satisfies the repository's seven-day package-age
policy. It remains an external MIT dependency, so its license ships with its installed package
rather than the new package's generated bundled-code notice. The package tarball is approximately
12 KB and PDFKit occupies approximately 10 MB installed. Supported APIs cover page operators,
rectangular clipping, built-in-font text, external links, and later PNG/JPEG embedding. They do not
cover external HarfBuzz runs or strict custom-font text.

### Preserve Core coordinates

PDF pages use points like Core, but PDF origins start at the lower-left. The writer port applies
one page transform from Core's top-left coordinate system. Translators then use semantic coordinates
directly and do not round values before writing.

### Separate traversal from PDF encoding

A page planner converts semantic records into immutable paint commands. A PDF writer encodes those
commands. This split enables exact command tests without parsing binary PDFs and writer integration
tests with text extraction and geometry inspection.

The command vocabulary starts with page, save/restore, clip, fill, stroke, text span, image, link,
and destination operations. New semantic features require explicit commands or diagnostics.

### Gate text fidelity before publication

The vertical slice uses PDF built-in fonts and records a `shaped-glyph-run` approximation for every
painted span. It cannot claim Word-faithful text output. Strict export refuses documents that paint
text until the writer consumes Core's admitted font programs and HarfBuzz glyph runs.

Re-shaping the same Unicode text with PDFKit or fontkit is acceptable only as a documented
best-effort experiment. It cannot satisfy strict fidelity because Core uses HarfBuzz as measurement
authority.

### Use session-owned resource capabilities

Images will come only from `ExportSession.validatedImageBytes`. The translator will not open
relationships, paths, URLs, or raw package parts. Font bytes will come from `admittedFontFace`
before strict embedding is implemented in the writer port.

### Make diagnostics part of the result

The result includes PDF bytes, page count, Core font-resolution evidence, and immutable fidelity
diagnostics. Unsupported records cannot disappear silently. Strict policy rejects any diagnostic
that changes visible output.

### Test records before pixels

Tests verify paint-command geometry against Core records, parse produced PDFs for pages,
resources, text, links, and metadata, and render selected fixtures for visual comparison. Word or
LibreOffice output can act as an external oracle, but it cannot replace deterministic structural
assertions.

## Risks / Trade-offs

- **PDFKit public APIs do not accept pre-shaped glyphs** → Keep the writer port replaceable. Do not
  build strict output on private `_font`, subset, width, or Unicode arrays.
- **Writer does not yet consume admitted font bytes** → Block strict text export and record the
  `shaped-glyph-run` approximation until embedding lands.
- **Font subsets remap glyph identifiers** → Preserve visual identity through a deterministic
  source-glyph-to-subset-CID map and generate an explicit ToUnicode map.
- **Node and browser compression differ** → Scope initial deterministic guarantees to Node and
  disable compression for future cross-runtime byte comparisons.
- **Large fonts or images exhaust memory** → Reuse Core limits, subset fonts, stream writer output,
  and add an explicit output-byte limit.
- **Semantic paint order is distributed across browser paint code** → Define one PDF page planner
  and compare its command order against focused semantic-paint fixtures.
- **PDF viewers differ** → Validate with at least two parsers or renderers and avoid undefined PDF
  behavior.
- **Dependency licenses or bundled notices are incomplete** → Run package metafile notice checks
  before publication.

## Migration Plan

1. Add the private package and a dependency-free paint-command contract.
2. Prove page creation, geometry transforms, simple Latin text, fills, strokes, and deterministic
   output through the writer spike.
3. Prove validated raster images and sanitized external and internal links.
4. Wire Core's admitted font programs and HarfBuzz glyph runs into the writer port.
5. Expand table, decoration, metadata, and destination coverage.
6. Add a reusable export session, expand fixture coverage, remove the private flag, add a release
   changeset, and publish.

Rollback removes the private package and its demo. Core and existing exporters remain unchanged.

## Open Questions

- Should the PDF writer port use PDFKit low-level operators or a smaller purpose-built encoder?
- Which PDF parser and rasterizer should be CI authorities for structural and visual validation?
- Which best-effort approximations are acceptable before strict mode is complete?
