# DOCX to PDF

`@docx-editor.dev/docx-to-pdf` converts DOCX documents to PDF on Node.js. It uses Core's pagination, font resolution, and positioned glyphs to produce searchable text.

The package is private and is not published to npm. It is distributed under the [EigenPal Pro Evaluation License](LICENSE.md). Production use requires a commercial agreement.

## Convert a document

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { exportPdf } from '@docx-editor.dev/docx-to-pdf';

const source = await readFile('document.docx');
const result = await exportPdf(source, {
  displayMode: 'proposed',
  comments: true,
});

await writeFile('document.pdf', result.bytes);
```

Conversion preserves the source DOCX. Browser applications must send the document to a Node.js server for conversion.

## Configure output

| Option | Default | Behavior |
| --- | --- | --- |
| `fidelityPolicy` | `'strict'` | Rejects unsupported or approximate output. Use `'best-effort'` to return available output with diagnostics. |
| `displayMode` | `'proposed'` | Includes proposed revisions. Use `'original'` for the original content or `'all-markup'` to show revisions. |
| `comments` | `true` | Includes native PDF annotations. Set to `false` to omit them. |
| `useSystemFonts` | `true` | Searches standard operating system directories for supported font files. Set to `false` to disable this search. |
| `timeoutMs` | `60000` | Sets the conversion deadline in milliseconds. |
| `maxOutputBytes` | `67108864` | Limits output to 64 MiB. You can lower this limit. |
| `signal` | — | Cancels conversion through an `AbortSignal`. |

The result includes `bytes`, `pageCount`, `layoutRevision`, `displayMode`, `fontResolution`, `diagnostics`, and `timings`. Timings report milliseconds spent opening the document, laying out pages, painting content, and encoding the PDF. Each result owns its byte buffer.

### Fonts

Use `fonts` to provide font sources before the installed and packaged sources. Use `fallbackFonts` to add sources after the packaged fonts. The exporter also reads embedded fonts before using a generic substitute for an unresolved family.

`glyphFallbacks` specifies an ordered list of fonts for missing glyphs. The defaults cover symbols, Arabic, CJK, mathematics, and color emoji. Emoji from a COLR font retain their palette colors and extractable text.

Core's `fontPolicy` controls substitution. Generic substitutions can change line breaks and page count, so strict export rejects them with a `font-substitution` diagnostic. Best-effort export uses the substitute and reports it. Inspect `result.fontResolution` for the selected fonts.

### Comments

Comments become range highlights or text notes. PDF viewers determine whether they display authors, dates, replies, and resolved state. Cross-page comments create an annotation on each affected page. Comments without a visible anchor become labeled notes on the first page.

Editing PDF annotations does not update the DOCX.

## Supported content

- Searchable multilingual text, small caps, text decorations, and tab leaders.
- Static TrueType and CFF fonts, including selected faces from font collections.
- Page sizes, page frames, headers, footers, footnotes, and endnotes.
- Text and image list markers, paragraph fills, and paragraph borders.
- Table text, shading, and resolved borders.
- Textboxes and structured equations.
- PNG and JPEG images with cropping, transforms, alpha transparency, and fixed opacity.
- Links, destinations, document metadata, and comments.

## Limitations

Charts, rotated table-cell text, unsupported equation fallbacks, advanced image effects, some revision presentation, and non-PNG/JPEG media produce diagnostics. Brightness and grayscale adjustments are not supported.

The writer rejects variable fonts, missing glyphs, prohibited embedding, fonts that prohibit subsetting, and font containers that cannot be encoded. Tagged PDF, PDF/A, encryption, forms, and reusable export sessions are not supported.

## Errors and resource limits

| Error | Cause |
| --- | --- |
| `PdfDocumentOpenError` | Core rejected the input document. Inspect `reason` and `detail`. |
| `PdfFidelityError` | Strict export encountered unsupported or approximate content. Inspect `diagnostics`. |
| `ExportResourceError` | Conversion was canceled or exceeded its deadline. |
| `PdfWorkLimitError` | Content exceeded a processing limit. |
| `PdfEncodingError` | PDF encoding failed or the output exceeded `maxOutputBytes`. |
| `TypeError` or `RangeError` | An argument is invalid or a size limit was exceeded. |

The writer compresses content streams and embeds font subsets. It retains layout records and font data until conversion finishes. Core's resource limits also apply.

Cancellation is checked between layout, paint, and encoding batches. Synchronous font and image operations cannot be interrupted mid-call. For a hard deadline or heap limit, run conversion in a worker and configure `resourceLimits.maxOldGenerationSizeMb`.

## Run the demo

From the repository root, run:

```sh
bun install
bun run dev:pdf
```

Open <http://127.0.0.1:5180>. For upload limits, server configuration, and production commands, see the [demo README](../../examples/docx-to-pdf/README.md).
