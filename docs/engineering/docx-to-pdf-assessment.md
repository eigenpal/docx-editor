# PDF export architecture

The PDF exporter uses Core for document parsing, font resolution, shaping, and pagination. The writer converts the resulting layout records into PDF objects with `pdf-lib` and embeds font subsets with `fontkit`.

## Conversion flow

1. Open a font-backed export session with the requested fonts, revision display mode, and resource limits.
2. Lay out the document and collect font-substitution diagnostics.
3. Traverse pages, text, drawings, and annotations in layout order. Read font and image bytes through the session.
4. Encode the PDF and return its bytes, page count, layout revision, display mode, font resolution, diagnostics, and phase timings.
5. Dispose of the session and release conversion resources.

The session remains open until encoding finishes. Each result owns its PDF byte buffer.

## Text and fonts

The writer uses Core's glyph IDs, positions, and Unicode mappings. Font subsets retain the glyphs used by the document and the mappings required for text extraction.

PDF sessions enable `documentLigatures` by default. This capability applies the document's optional-ligature settings during both layout measurement and glyph shaping. It is part of the shaping fingerprint.

Font sources include caller-provided, installed, packaged, and embedded fonts. Generic substitutes are considered after embedded fonts and produce diagnostics when used.

## Diagnostics and resource limits

Strict export rejects unsupported or approximate content. Best-effort export returns available output with diagnostics. Core's font policy controls substitution separately.

Conversion checks cancellation and deadlines between processing batches. Use a worker for hard deadlines and heap limits, since synchronous font and image operations cannot be interrupted mid-call.

The local demo runs one worker per request. The hosted demo runs conversion in a server function with per-instance concurrency and resource limits.

For API usage and supported content, see the [package README](../../packages/docx-to-pdf/README.md).
