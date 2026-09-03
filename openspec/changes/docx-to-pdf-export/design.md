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

### Private first slice boundary

**In scope today:**

- Physical page boxes sized from Core pagination.
- Body, header, and footer text spans and list markers at semantic geometry, including text that
  flows inside table cells.
- Sanitized external and internal link annotations over span boxes.
- Named internal destinations from Core-published geometry.
- Bounded document metadata in the PDF information dictionary.
- Structured fidelity diagnostics for every unsupported or approximated record.
- Strict export refusal when any visible approximation or unsupported diagnostic exists.

**Deferred in this slice:**

- Exact HarfBuzz glyph placement.
- Table structure and decoration (cell text still paints; a `table` diagnostic records the gap).
- Images, equations, inline and anchored drawings.
- Paragraph fills, borders, shading, tab leaders, and note areas.
- Reusable export sessions over Core's export session.

### Current text fidelity boundary

PDFKit integration limits text fidelity even when the writer embeds exact Core-admitted font bytes:

- `exportPdf` collects admitted faces from the live export session, preserves aliases per request
  key, and shares one bounded byte copy per admitted resource identity so PDFKit cannot observe
  mutation while encoding aliases of the same face.
- When the PDFKit writer finds a matching `(family, weight, style)` request and the PDF-layer
  embedding gate accepts the face, it calls `registerFont` with the shared byte buffer Core
  measured. PDFKit/fontkit then embeds those bytes and reshapes the span's Unicode through its own
  engine.
- When no admitted face matches, or embedding is refused, the writer maps semantic styles to PDF
  built-in fonts only when the span text is WinAnsi-representable. Non-exact built-in matches also
  record a `standard-font-substitution` approximation. WinAnsi-unsafe fallback text is omitted and
  records a `standard-font-encoding` unsupported diagnostic.
- PDFKit's public text API cannot accept an external HarfBuzz glyph run or encode Core glyph IDs or
  positions. Every painted text span therefore records a truthful `shaped-glyph-run` approximation,
  whether the span used embedded bytes or a built-in font. Strict export refuses documents that paint
  text until a writer path encodes Core glyph positions.
- Validated image bytes must still be copied before session disposal. EMF, WMF, and TIFF also
  require a host converter. Image embedding remains deferred.
- Review occurrences expose source ranges but no page rectangles for PDF annotations.
- Core no longer declares the unused `pdf-lib` optional peer. PDF export lives in
  `@docx-editor.dev/docx-to-pdf` with PDFKit instead.

### Embedding permissions and TTC/OTC handling

Embedding permission is enforced at Core admission and again at the PDF layer:

- Core's font resource lane treats `availability: 'forbidden'` as a hard refusal. Forbidden faces
  never reach `admittedFontFace`.
- Document-embedded faces pass through Core's embedded-font mapper with bounded byte and aggregate
  budgets. Faces dropped as `overLimit` or `malformed` appear in `fontResolution.droppedEmbeddedFonts`
  and never admit bytes. Explicit caller and packaged origins take first-wins precedence over
  document-embedded faces for the same `(family, weight, style)` request.
- Before `registerFont`, the PDF writer parses each admitted sfnt OS/2 `fsType` table. It refuses
  embedding when bit 1 (`0x0002`, restricted license embedding) or bit 8 (`0x0100`, no subsetting)
  is set. No-subsetting faces are refused because PDFKit has no safe full-font embedding mode.
  Refused spans emit a `font-embedding-permission` unsupported diagnostic and fall back to PDF
  built-in fonts for painting.
- Core validates collection containers with `faceIndex` and publishes the full collection bytes plus
  the index Core measured (`identity` is `hash#faceIndex`). Document-embedded parts map with
  `faceIndex: 0` because each embedded part is a single face.
- When Core admits a collection container with any `faceIndex`, the PDF writer refuses embedding
  because a verifiable collection face selector is unavailable. PDFKit exposes a collection family
  selector, but Core does not yet publish the selected face name needed to prove `faceIndex`
  selection, so embedding would not be verifiable.

## Goals / Non-Goals

**Goals:**

- Prove that an immutable Core layout can drive valid multi-page PDF output in a private first
  slice.
- Preserve Core page geometry, text baselines, links, metadata, and revision display modes for the
  records this slice paints.
- Embed exact Core-admitted font bytes through PDFKit when a matching face resolves, while
  documenting that Unicode reshaping still blocks strict text fidelity.
- Wire Core HarfBuzz glyph runs into the PDF writer when strict text fidelity is required.
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
byte collection. PDFKit text remains best-effort only until Core glyph positions are encoded.

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

The vertical slice embeds exact Core-admitted font bytes when a matching face resolves and the PDF
layer accepts its sfnt `fsType` and `faceIndex`, but PDFKit still reshapes Unicode and cannot
encode Core glyph IDs or positions. It falls back to PDF built-in fonts when no admitted face
matches or embedding is refused. Every painted span records a truthful `shaped-glyph-run`
approximation; non-exact built-in fallback also records `standard-font-substitution`. Strict export
refuses documents that paint text until the writer encodes Core's HarfBuzz glyph positions.

Re-shaping the same Unicode text with PDFKit or fontkit is acceptable only as a documented
best-effort experiment. It cannot satisfy strict fidelity because Core uses HarfBuzz as measurement
authority.

### Use session-owned resource capabilities

Images will come only from `ExportSession.validatedImageBytes`. The translator will not open
relationships, paths, URLs, or raw package parts. Font bytes come from `admittedFontFace` on the
live export session. `exportPdf` preserves aliases per request key while sharing one bounded copy
per resource identity; the PDF writer registers only faces Core admits and the PDF-layer embedding
gate accepts.

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
- **Embedded bytes still reshape through PDFKit** → Block strict text export and record the
  `shaped-glyph-run` approximation until Core glyph positions are encoded.
- **Font subsets remap glyph identifiers** → Preserve visual identity through a deterministic
  source-glyph-to-subset-CID map and generate an explicit ToUnicode map.
- **Nonzero TTC/OTC faceIndex is not verifiable yet** → Refuse every TTC/OTC collection container
  and record `font-embedding-permission` until Core exposes the selected collection face name and
  the writer can prove `faceIndex` selection.
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
4. Encode Core HarfBuzz glyph positions in the writer port; add verifiable TTC/OTC collection face
   selection when Core publishes the selected face name.
5. Expand table decoration, metadata, and destination coverage.
6. Add a reusable export session, expand fixture coverage, remove the private flag, add a release
   changeset, and publish.

Rollback removes the private package and its demo. Core and existing exporters remain unchanged.

## Open Questions

- Should the PDF writer port use PDFKit low-level operators or a smaller purpose-built encoder?
- Which PDF parser and rasterizer should be CI authorities for structural and visual validation?
- Which best-effort approximations are acceptable before strict mode is complete?
