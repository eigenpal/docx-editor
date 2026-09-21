# DOCX-to-PDF exporter assessment

> A point-in-time engineering decision record from the start of the work, kept for the reasoning behind building on the Core export foundation rather than adopting the earlier prototype. It is not current documentation: for what the exporter supports today see [the package README](../../packages/docx-to-pdf/README.md).

## Decision

Build the exporter on the shared Core export foundation. Replace the prototype's text encoding path. Do not restart document parsing, layout, or font resolution.

Start from `main` in the `feat/pdf-exporter` worktree. Use the existing PDF branch as a reference, rather than merging its layout changes wholesale.

## Evidence

This assessment compares `main` at `baae2a5fc` with the locally available `origin/feat/docx-to-pdf` at `4e96894b4`. It is a source review, not a rendered fidelity measurement. The remote branch has not been refreshed from the server.

- Core already exposes `openFontBackedDocumentForExport`, immutable layout, `admittedFontFace`, `shapeLaidOutText`, and `validatedImageBytes`.
- The prototype opens that session but does not call `shapeLaidOutText`.
- Its planner converts a span to text and a rectangle. Its writer calls `doc.widthOfString()` and `doc.text()`, then scales the independently shaped text to the rectangle width. Matching the total width cannot preserve each glyph's position or a shaping cluster's boundaries.
- The writer reports `shaped-glyph-run` for every painted text span. The strict export test expects even a simple text document to fail.
- The prototype documents images, table borders, equations, notes, and reusable sessions as deferred. Cell text and shading do not constitute table fidelity.
- The branch's merge-base diff touches 43 Core files, including wrapping, paragraph borders, list resolution, and page geometry. These changes need independent review before adoption.

The original plan is under `openspec/changes/docx-to-pdf-export/` on the PDF branch. Its requirement to encode Core's shaped glyphs remains the right gate.

## Reuse and replace

| Component | Action | Reason |
| --- | --- | --- |
| Core export sessions and font provisioning | Reuse | They already serve the Markdown exporter. |
| Core pagination and semantic geometry | Reuse | One layout authority prevents export-specific reflow. |
| Bounded diagnostics, cancellation, and resource tests | Port selectively | These are useful independently of the writer. |
| Font permission and collection-face checks | Port and verify | Encoding must use the face Core admitted. |
| Page, link, metadata, and coordinate tests | Port selectively | They express reusable output requirements. |
| Unicode text plus stretched rectangle commands | Replace | They discard Core's shaping information. |
| PDFKit high-level text calls | Replace | They perform a second shaping pass. |
| macOS device-grid profile and layout adjustments | Defer | Establish Core geometry parity before platform-specific tuning. |
| Public paint-command API | Keep internal initially | Writer details should not become a compatibility burden. |

## Implementation sequence

1. **Prove the writer.** Encode one Core-shaped run using admitted font bytes, glyph IDs, advances, offsets, and explicit Unicode mapping. Support a deterministic source-glyph-to-subset map. Do not access PDFKit private font state. Compare maintained writer APIs with a small isolated font encoder before selecting the implementation.
2. **Connect one-shot conversion.** Provide `exportPdf(bytes, options)` with packaged fonts, caller overrides, mixed page sizes, body text, headers, footers, and links. Keep the session alive until encoding finishes. Preserve strict refusal for unsupported visible records.
3. **Paint document structure.** Add paragraph fills and borders, table borders and clipping, raster images, crop and transforms, and explicit paint order. Obtain image bytes only through the live session capability.
4. **Expand fidelity.** Add notes, equations, drawings, text decorations, and review presentation from Core records. Report every remaining omission.
5. **Integrate the product.** Add the download demo and export documentation, then reusable sessions if required. Keep the package private until its supported document set passes the acceptance gates.

## Acceptance gates

- A supported text-only document passes strict export without a reshaping approximation. Unsupported text fails explicitly.
- Latin ligatures, combining marks, Arabic, Indic, CJK, bidirectional text, font fallback, and collection faces have focused fixtures.
- Parsed PDF glyph positions match Core geometry. Extracted text preserves cluster Unicode, including supplementary characters and ligatures.
- Rendered pages pass visual inspection, with selected Word output used as a separate reference. Matching Core geometry and matching that reference are distinct claims.
- Page count, page boxes, links, destinations, and metadata have parser checks.
- Cancellation, deadlines, malformed input, output limits, and session cleanup have tests that exercise failure during encoding as well as startup.
- The package passes build, types, lint, API, dependency-boundary, license, and notice checks. Markdown and browser imports do not acquire PDF dependencies.

## First implementation boundary

The first deliverable is exact, searchable text in a private exporter package. It is not full DOCX fidelity. Passing this gate avoids adding more decoration on top of a writer that cannot preserve the layout it receives.

## Implemented private exporter

The separate `feat/pdf-exporter` worktree implements the fresh TypeScript writer, using `pdf-lib` low-level PDF objects and `fontkit` for subsetting. Text comes from Core's admitted shaped runs; the writer does not reshape it. The package exports `exportPdf`, with strict fidelity, proposed revision view, and native comments by default. It stays private under the EigenPal Pro Evaluation license.

Implemented output includes positioned searchable text, static TrueType/CFF and selected TTC faces, paragraph/table paint, headers/footers, raster crop and affine transforms, fixed opacity, text links, destinations, metadata, and native comments. Core changes are additive: fixed image opacity and original image transform corners survive clipping and layout translation.

The local React demo uses a Node worker per conversion, bounded uploads, a hard deadline, cancellation, explicit best-effort retry, preview, and download. It is not added to public deployment. Run `bun run dev:pdf` from this worktree.

Verification completed: exporter and focused drawing tests; Core export and Markdown regressions; Node server tests; browser sample download and strict-to- best-effort retry; multilingual PDF.js text extraction; visual inspection with Poppler and PDF.js; build/types/lint/API/license/notices/i18n/lane boundaries.

This is the initial useful subset, not completion of the broader fidelity roadmap. Notes, equations, textboxes, advanced effects, rotated cell text, image hyperlinks, and some revision presentation remain explicit diagnostics. No Word-reference pixel parity or comprehensive viewer interoperability is claimed. The package must remain private while those broader acceptance gates are developed.

## Fidelity follow-up

The real editor sample replaced the simplified PDF demo sample. Strict export produces 27 pages with no unsupported-content diagnostics. Added note text/separators, structured equation paint, leaders, underline variants, small caps, page frames, image links, and admitted glyph fallback. Fixed implicit table-cell end-mark inflation; retained explicit mark and superscript behavior covered by Word-derived Core tests.

A comparison script in the package creates the repeatable paired page and overlay report. The exporter and its development tooling remain under the EigenPal Pro License. Font assets carry their own original OFL notices. Shared Core changes expose the shaping evidence and fix layout before PDF painting.

The package README records the supported sample and the areas where PDF renderers differ most. An equal page count and complete content are not a claim of pixel fidelity.
