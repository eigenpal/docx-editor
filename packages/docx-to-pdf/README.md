# DOCX to PDF

Private TypeScript workspace package, licensed under the **EigenPal Pro License**. It is not published to npm.

The Node converter consumes Core's layout and HarfBuzz glyph runs. It embeds the admitted font faces and positions those glyphs directly. It does not reshape text, repaginate with another engine, or run a browser.

```ts
import { exportPdf, PdfFidelityError } from '@docx-editor.dev/docx-to-pdf';

const result = await exportPdf(docxBytes, {
  displayMode: 'proposed',
  comments: true,
});
await writeFile('document.pdf', result.bytes);
```

## Defaults and controls

- `fidelityPolicy: 'strict'`: reject unsupported or approximate requested output. Select `'best-effort'` explicitly to receive available output with diagnostics.
- `displayMode: 'proposed'`: show final text. `'original'` and `'all-markup'` use Core's corresponding revision projections. Conversion never changes the DOCX.
- `comments: true`: preserve native PDF comments. Set `false` to omit annotations.
- `useSystemFonts`: defaults to true. Read known Word font filenames from standard OS font directories. Set false for portable packaged fonts.
- `glyphFallbacks`: ordered admitted faces for a span missing glyphs. Defaults cover symbols, Arabic, CJK, mathematics, and monochrome emoji.
- `fonts`: caller font origins precede installed Word fonts and packaged substitutes. `fallbackFonts` follow the packaged origins. Core's separate `fontPolicy` controls substitution; inspect `result.fontResolution` for the faces actually used.
- `timeoutMs: 60000`, `maxOutputBytes: 67108864`, and an optional `signal` bound work. The byte limit can be lowered but not raised. Core resource limits still apply.

The result contains owned `bytes`, `pageCount`, `layoutRevision`, `displayMode`, `fontResolution`, and frozen `diagnostics`. PDF bytes are mutable by JavaScript convention, but never share storage with another result or a live export session.

`PdfDocumentOpenError` preserves the rejection reason. `PdfFidelityError` includes bounded diagnostics. `ExportResourceError` reports aborts and deadlines. `PdfEncodingError` reports encoder failures. Invalid options raise `TypeError` or `RangeError`.

## Supported output

The writer supports static TrueType and CFF fonts, selected collection faces, positioned multilingual glyphs, Unicode extraction, page sizes, headers and footers, list markers, paragraph fills, single/double/dashed/dotted paragraph borders, table text and shading, resolved table borders, PNG/JPEG images, crop and affine transforms, fixed image opacity, links, destinations, and metadata. Notes, equation geometry, tab leaders, page frames, small caps, and underline variants also paint from Core records.

PDF sessions enable Core's `documentLigatures` shaping capability, which applies authored optional ligatures and document compatibility to both layout measurement and emitted glyphs. The capability participates in the shaping fingerprint. Browser shaping and DOM paint retain their native ligature behavior because the canvas fallback cannot select individual OpenType features; adding that browser capability requires a matching measurement port. Required script substitutions remain enabled in either mode.

Comments use native range highlights or text notes. Authors, dates, replies, and resolved state are preserved where PDF viewers support them. Cross-page anchors produce page-local annotations. A comment without a visible anchor becomes a labeled first-page note. Editing a PDF annotation does not update the DOCX.

Strict fidelity means representing Core's accepted layout. It does not certify pixel identity with Microsoft Word. Font substitutions remain possible under Core's default font policy.

## Output size and memory

Content streams are Flate-compressed, and fonts are embedded as subsets of the glyphs the document uses. Text is written one positioned run at a time: a run starts with a text matrix, and the glyphs after it advance from their own widths, with an explicit adjustment only where the laid-out position differs from the advance. A 521-page document produces about 4.8 MB, near 9.3 kB per page.

The writer holds the laid-out pages and the admitted font data for the length of the call. The same 521-page document peaks near 380 MiB of old space. Run conversion in a worker with `resourceLimits.maxOldGenerationSizeMb` when you need a hard ceiling; the demo server does this and reports the limit instead of failing the host.

## Explicit limitations

Textboxes, rotated table-cell text, unsupported equation fallbacks, advanced image effects, some revision presentation, and non-PNG/JPEG media produce diagnostics. Variable fonts, missing glyphs, prohibited embedding, and font containers the subsetter cannot encode are refused. Fonts that prohibit subsetting are refused because this writer embeds subsets.

Color adjustments such as brightness and grayscale are not applied. Bitmap alpha and fixed picture opacity are supported. Tagged PDF, PDF/A, encryption, forms, DOCX comment round trips, and reusable export sessions are outside this package's initial scope.

Cancellation is cooperative between layout, paint, and encoding batches. A synchronous third-party font or image operation cannot be interrupted mid-call. Use a worker for hard deadlines. The included demo does this.

## Run the demo

From the repository root:

```sh
bun install
bun run dev:pdf
```

Open `http://127.0.0.1:5180`. Uploads stay in memory on the local server. The server allows one active conversion, a 20 MiB upload, and a 60-second deadline. A worker handles each conversion and is terminated on cancellation. Public hosting is not configured.

## Local PDF validation

Run `bun run validation:pdf` from the repository root for the local scorer and comparison viewer at `http://127.0.0.1:5190`. Its gitignored inbox generates candidate and configured reference PDFs sequentially, with bounded resources. Review the first divergent page from top to bottom, filter worst offenders, and optionally show pixel differences. Agents can enqueue inputs or read JSON triage. See the [validator workflow](scripts/validator/README.md) for setup and commands.

## Verification

```sh
bun test packages/docx-to-pdf/test
bun run --filter '@docx-editor.dev/docx-to-pdf' typecheck
bun run build:pdf
node --test examples/docx-to-pdf/server.node.test.mjs
```

`bun packages/docx-to-pdf/test/render-fixtures.ts` writes visual QA PDFs under `.cache/pdf/`. The test fonts include licensed script-specific subsets; they are not runtime font defaults.

## Cross-check against another renderer

Install LibreOffice, Poppler, and Python 3, then run from this package:

```sh
bun run compare:libreoffice
```

The command converts the unchanged editor demo with both renderers and writes paired page images, an overlay viewer, extracted text, font evidence, and diagnostics to `.cache/pdf/libreoffice-comparison/`. Pass a DOCX and an empty output directory for another run. Both use the proposed view without revision marks, and the second runs with an isolated temporary profile. It is a development aid for spotting differences worth investigating; it is not a target to match, and the exporter neither launches nor requires it.

The 50-category editor demo exports in strict mode with 27 pages and no unsupported-content diagnostics, both with installed fonts and with packaged fonts only. Font substitutions, monochrome emoji, equation layout, and super/subscript sizing are the areas where output differs most between renderers. See `VALIDATION.md`.

For the corpus benchmark, the comparison procedure, measured gaps, and stress results, see [VALIDATION.md](./VALIDATION.md). A successful export is not a statement about pixel fidelity.

Profile memory with `bun packages/docx-to-pdf/scripts/profile-memory.ts input.docx` from the repository root. Add `--collect` for diagnostic garbage collection between phases. Production exports never force garbage collection. The profiler reports both process memory and JavaScript heap statistics; these measure different allocations.

To reuse captured references without opening Word or LibreOffice, pass `--reference-manifest manifest.json` to `scripts/benchmark.py`. The manifest declares `engine`, `displayMode: "proposed-no-markup"`, and a `documents` object keyed by each source DOCX's SHA-256. Each entry provides `pdf`, `pdfSha256`, and optional `provenance`. Relative PDF paths resolve beside the manifest. The benchmark verifies both identities and records missing references without launching an application. Use `--export-only` for native export and memory measurements alone.
