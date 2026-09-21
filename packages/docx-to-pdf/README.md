# DOCX to PDF

`@docx-editor.dev/docx-to-pdf` adds PDF support to the engine. It is a private TypeScript workspace package, licensed under the EigenPal Pro License. It is not published to npm.

The Node converter consumes Core's layout and HarfBuzz glyph runs. It embeds the admitted font faces and positions those glyphs directly. It does not reshape text, repaginate with another engine, or run a browser.

The following example converts a document and writes the PDF:

```ts
import { exportPdf, PdfFidelityError } from '@docx-editor.dev/docx-to-pdf';

const result = await exportPdf(docxBytes, {
  displayMode: 'proposed',
  comments: true,
});
await writeFile('document.pdf', result.bytes);
```

## Defaults and controls

- `fidelityPolicy: 'strict'` rejects requested output that is unsupported or approximate. To receive available output with diagnostics, select `'best-effort'` explicitly.
- `displayMode: 'proposed'` shows the final text. `'original'` and `'all-markup'` use Core's corresponding revision projections. Conversion never changes the DOCX.
- `comments: true` preserves native PDF comments. To omit annotations, set it to `false`.
- `useSystemFonts` defaults to `true`. It reads known Word font filenames from standard OS font directories. For portable packaged fonts, set it to `false`.
- A family written as a face name, such as `Times New Roman Bold`, and a localized East Asian name, such as `宋体`, resolve to the faces Word uses for them. When Helvetica or a common East Asian family is absent, a packaged face stands in for it.
- `glyphFallbacks` lists ordered admitted faces for a span that is missing glyphs. The defaults cover symbols, Arabic, CJK, mathematics, and color emoji. An emoji from a COLR face paints its palette layers in color and stays extractable as text.
- `fonts` places caller font origins before installed Word fonts and packaged substitutes. `fallbackFonts` follow the packaged origins. Core's separate `fontPolicy` controls substitution. To see the faces the export used, inspect `result.fontResolution`.
- `timeoutMs: 60000`, `maxOutputBytes: 67108864`, and an optional `signal` bound the work. You can lower the byte limit, but you cannot raise it. Core resource limits still apply.

The result contains owned `bytes`, `pageCount`, `layoutRevision`, `displayMode`, `fontResolution`, and frozen `diagnostics`. PDF bytes are mutable by JavaScript convention. They never share storage with another result or a live export session.

`PdfDocumentOpenError` preserves the rejection reason. `PdfFidelityError` includes bounded diagnostics. `ExportResourceError` reports aborts and deadlines. `PdfEncodingError` reports encoder failures. Invalid options raise `TypeError` or `RangeError`.

## Supported output

The writer supports the following output:

- Static TrueType and CFF fonts, and selected collection faces.
- Positioned multilingual glyphs, and Unicode extraction.
- Page sizes, headers and footers, and list markers.
- Paragraph fills, and single, double, dashed, and dotted paragraph borders.
- Table text, table shading, and resolved table borders.
- PNG and JPEG images, crop and affine transforms, and fixed image opacity.
- Links, destinations, and metadata.

Notes, equation geometry, tab leaders, page frames, small caps, and underline variants also paint from Core records.

PDF sessions enable Core's `documentLigatures` shaping capability. The capability applies authored optional ligatures and document compatibility to both layout measurement and emitted glyphs. It participates in the shaping fingerprint. Browser shaping and DOM paint retain their native ligature behavior, because the canvas fallback cannot select individual OpenType features. Adding that browser capability requires a matching measurement port. Required script substitutions remain enabled in either mode.

Comments use native range highlights or text notes. Authors, dates, replies, and resolved state survive where PDF viewers support them. Cross-page anchors produce page-local annotations. A comment without a visible anchor becomes a labeled first-page note. Editing a PDF annotation does not update the DOCX.

Strict fidelity means representing Core's accepted layout. It does not certify pixel identity with any other renderer. Font substitutions remain possible under Core's default font policy.

## Output size and memory

The writer Flate-compresses content streams, and embeds fonts as subsets of the glyphs the document uses. It writes text one positioned run at a time. A run starts with a text matrix, and the glyphs after it advance from their own widths. An explicit adjustment appears only where the laid-out position differs from the advance. A 521-page document produces about 4.8 MB, near 9.3 kB per page.

The writer holds the laid-out pages and the admitted font data for the length of the call. The same 521-page document peaks near 380 MiB of old space. If you need a hard ceiling, run conversion in a worker with `resourceLimits.maxOldGenerationSizeMb`. The demo server does this, and reports the limit instead of failing the host.

## Explicit limitations

Charts and other non-picture graphics, rotated table-cell text, unsupported equation fallbacks, advanced image effects, some revision presentation, and non-PNG/JPEG media produce diagnostics. A textbox paints its fill, outline, and clipped text at its place in the drawing order. The writer refuses variable fonts, missing glyphs, prohibited embedding, and font containers the subsetter cannot encode. It also refuses fonts that prohibit subsetting, because it embeds subsets.

The writer does not apply color adjustments such as brightness and grayscale. It does support bitmap alpha and fixed picture opacity. Tagged PDF, PDF/A, encryption, forms, DOCX comment round trips, and reusable export sessions are outside this package's scope.

Cancellation is cooperative between layout, paint, and encoding batches. A synchronous third-party font or image operation cannot be interrupted mid-call. For hard deadlines, use a worker. The included demo does this.

## Run the demo

From the repository root, run:

```sh
bun install
bun run dev:pdf
```

Open `http://127.0.0.1:5180`. Uploads stay in memory on the local server. The server allows one active conversion, a 20 MiB upload, and a 60-second deadline. A worker handles each conversion, and cancellation terminates that worker. The local server binds to loopback. The hosted demo converts through a server function with the same limits, and accepts requests only from its own page.

## Verification

Run the following commands to verify the package:

```sh
bun test packages/docx-to-pdf/test
bun run --filter '@docx-editor.dev/docx-to-pdf' typecheck
bun run build:pdf
node --test examples/docx-to-pdf/server.node.test.mjs
```

To find out why a folder of documents does not convert strictly, run the triage script:

```sh
bun packages/docx-to-pdf/scripts/triage.ts <dir> --out report.json --pdf out/
```

It converts each document strictly, then in best-effort mode when strict export refuses. For each document it prints the diagnostics grouped by code with their pages and messages, the font families no admitted face covers, and a hint at the usual cause, followed by a tally of causes across the folder. `--baseline previous.json` lists the documents that got worse or better since an earlier report. The script prints file names, codes, and font family names, never document text.

`bun packages/docx-to-pdf/test/render-fixtures.ts` writes visual QA PDFs under `.cache/pdf/`. The test fonts include licensed script-specific subsets. They are not runtime font defaults.

The 50-category editor demo exports in strict mode with 27 pages and no unsupported-content diagnostics. This holds both with installed fonts and with packaged fonts only. Font substitution, emoji art, equation layout, and super/subscript sizing are the areas where output differs most between PDF renderers. A successful export is not a statement about pixel fidelity.

## Memory

Profile memory with `bun packages/docx-to-pdf/scripts/profile-memory.ts input.docx` from the repository root. Add `--collect` for diagnostic garbage collection between phases. Production exports never force garbage collection. The profiler reports both process memory and JavaScript heap statistics. These measure different allocations.
