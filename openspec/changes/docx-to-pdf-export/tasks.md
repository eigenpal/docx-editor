## 1. Package and writer evaluation

- [x] 1.1 Add the private `@docx-editor.dev/docx-to-pdf` package with build, typecheck, test,
      notice, and API Extractor wiring.
- [x] 1.2 Define a dependency-neutral PDF paint-command model and page coordinate transform.
- [x] 1.3 Add command-model tests for mixed page sizes, clipping, stacking, and deterministic
      numeric serialization.
- [x] 1.4 Spike PDFKit behind an internal writer port and verify valid pages, collected bytes, and
      deterministic document identifiers.
- [x] 1.5 Record the writer decision for glyph positioning, font subsetting, images, links, bundle
      size, and license notices.

## 2. Semantic page planning

- [x] 2.1 Plan page boxes and body, header, and footer text spans from `ExportSemanticLayout`.
      Page backgrounds and furniture decoration remain deferred.
- [ ] 2.2 Translate paragraph fills, borders, lines, tab leaders, and non-text decoration into
      ordered commands.
- [ ] 2.3 Translate table cells, borders, continuation fragments, and clipping into ordered
      commands.
- [ ] 2.4 Translate equations, vector shapes, inline drawings, and anchored drawings with explicit
      stacking.
- [x] 2.5 Emit structured diagnostics for every unsupported or approximated semantic record.

## 3. Text and font fidelity gate

- [ ] 3.1 Add Latin, combining-mark, Arabic, Indic, CJK, bidirectional, and fallback-font
      characterization fixtures.
- [x] 3.2 Record that PDFKit cannot encode externally shaped glyph IDs with extractable Unicode.
- [x] 3.3 Confirm Core already publishes admitted font bytes and HarfBuzz glyph runs; the remaining
      gap is PDFKit writer integration.
- [x] 3.4 Add strict refusal when visible approximations or unsupported records exist.
- [ ] 3.5 Embed and subset admitted font programs and encode Core glyph positions in the writer
      port.

## 4. Images, links, and metadata

- [ ] 4.1 Embed raster images obtained only through `validatedImageBytes`.
- [ ] 4.2 Apply semantic crop, transform, clip, opacity, and image accessibility metadata.
- [x] 4.3 Emit external link annotations from sanitized semantic URLs.
- [x] 4.4 Emit internal destinations and links from Core-published destination geometry.
- [x] 4.5 Map bounded document metadata and deterministic creation data into the PDF.

## 5. Public package API

- [x] 5.1 Add one-shot byte export with cancellation, deadlines, revision display mode, and resource
      limits.
- [ ] 5.2 Add a reusable PDF export session over Core's export session.
- [x] 5.3 Return immutable PDF bytes, page count, font-resolution evidence, and fidelity
      diagnostics.
- [x] 5.4 Add typed document, fidelity, resource, and encoding failures.
- [ ] 5.5 Document Node runtime support, strict and best-effort policies, and session disposal.

## 6. Verification and publication gate

- [ ] 6.1 Parse generated PDFs and verify pages, boxes, resources, text extraction, links, and
      metadata.
- [ ] 6.2 Add rendered fixture comparisons against Core geometry and selected Word oracle output.
- [ ] 6.3 Add cancellation, timeout, resource-limit, malformed-input, and cleanup tests.
- [ ] 6.4 Run package typecheck, lint, tests, API checks, notice generation, and strict OpenSpec
      validation.
- [ ] 6.5 Keep the package private until strict text fidelity and representative fixture gates
      pass.
- [ ] 6.6 Add consumer documentation, feature matrix entries, and a release changeset before
      publication.
