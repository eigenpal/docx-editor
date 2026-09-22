# DOCX to PDF

`@docx-editor.dev/docx-to-pdf` converts DOCX documents to PDF on Node.js. It uses Core's pagination, font resolution, and positioned glyphs to produce searchable text.

The package is private and is not published to npm. It is distributed under the [EigenPal Pro License](LICENSE.md). Production use requires a commercial agreement.

## Before you begin

Use Node.js 20.16.0 or later in the 20.x release line, or Node.js 22.3.0 or later. The converter needs WebAssembly and its packaged font assets. Install a compatible `@docx-editor.dev/core` peer alongside the converter in your private distribution. Keep one Core copy in your application.

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

## Reuse a layout

Use `openDocumentForExport` and `exportPdfFrom` to reuse font resolution and layout. The session also works with Markdown's `exportMarkdownFrom`. Dispose the session after all exports, including failed exports. For an example, see [Compare PDF and Markdown conversion](docs/markdown-contract.md#reuse-one-session).

## Configure output

| Option | Default | Behavior |
| --- | --- | --- |
| `fidelityPolicy` | `'strict'` | Rejects unsupported or approximate output. Use `'best-effort'` to return available output with diagnostics. |
| `displayMode` | `'proposed'` | Includes proposed revisions. Use `'original'` for the original content or `'all-markup'` to show revisions. |
| `comments` | `true` | Includes native PDF annotations. Set to `false` to omit them. |
| `useSystemFonts` | `true` | Searches standard operating system directories for supported font files. Set to `false` to disable this search. |
| `timeoutMs` | `60000` | Sets the conversion deadline in milliseconds. |
| `maxOutputBytes` | `67108864` | Limits output to 64 MiB. You can lower this limit. |
| `maxPages` | `10000` | Limits output pages after layout. You can lower this limit. |
| `signal` | — | Cancels conversion through an `AbortSignal`. |

The result includes `bytes`, `pageCount`, `layoutRevision`, `displayMode`, `fontResolution`, `diagnostics`, and `timings`. Timings report milliseconds spent opening the document, laying out pages, painting content, and encoding the PDF. Each result owns its byte buffer.

### Fonts

Use `fonts` to provide font sources before the installed and packaged sources. Use `fallbackFonts` to add sources after the packaged fonts. The exporter also reads embedded fonts before using a generic substitute for an unresolved family. Use `lastResortFonts` after embedded fonts and before generic substitutes.

`glyphFallbacks` specifies an ordered list of fonts for missing glyphs. The defaults cover symbols, Arabic, CJK, mathematics, and color emoji. Emoji from a COLR font retain their palette colors and extractable text.

Core's `fontPolicy` controls failed font sources and incomplete face coverage. Generic substitutions can change line breaks and page count, so strict export rejects them with a `font-substitution` diagnostic. Best-effort export uses the substitute and reports it. Inspect `result.fontResolution` for the selected fonts.

For custom font files and policy choices, see [Configure PDF fonts](docs/fonts.md).

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

The writer rejects variable fonts, missing glyphs, prohibited embedding, fonts that prohibit subsetting, and font containers that cannot be encoded. Tagged PDF, PDF/A, encryption, and forms are not supported.

## Errors and resource limits

| Error | Cause |
| --- | --- |
| `PdfDocumentOpenError` | Core rejected the input document. Inspect `reason` and `detail`. |
| `PdfFidelityError` | Strict export encountered unsupported or approximate content. Inspect `diagnostics`. |
| `ExportResourceError` | Cancellation, deadlines, font-policy refusals, or layout failures. Inspect `code`. |
| `PdfWorkLimitError` | Content exceeded a processing limit. |
| `PdfOutputLimitError` | Encoded bytes exceeded `maxOutputBytes`. Inspect `limit` and `actual`. Extends `PdfEncodingError`. |
| `PdfPageLimitError` | Layout exceeded `maxPages`. Inspect `limit` and `actual`. Extends `RangeError`. |
| `PdfEncodingError` | PDF encoding failed. Inspect `cause`. |
| `TypeError` or `RangeError` | An argument is invalid or a size limit was exceeded. |

The writer compresses content streams and embeds font subsets. It retains layout records and font data until conversion finishes. Core's resource limits also apply.

Cancellation is checked between layout, paint, and encoding batches. Synchronous font and image operations cannot be interrupted mid-call. For a hard deadline or heap limit, run conversion in a worker and configure `resourceLimits.maxOldGenerationSizeMb`.

## Developer guides

- [Compare PDF and Markdown conversion](docs/markdown-contract.md): shared controls and intentional differences.

- [PDF export API](docs/api.md): options, result fields, diagnostics, stable error codes, and resource boundaries.
- [Configure PDF fonts](docs/fonts.md): custom files, source order, policies, and troubleshooting.
- [Integrate PDF conversion](docs/integrations.md): HTTP responses, Next.js, deployment, and batches.

## Run the demo

From the repository root, run:

```sh
bun install
bun run dev:pdf
```

Open <http://127.0.0.1:5180>. For upload limits, server configuration, and production commands, see the [demo README](../../examples/docx-to-pdf/README.md).
