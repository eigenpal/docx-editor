# DOCX to Markdown

Use `@docx-editor.dev/docx-to-markdown` to convert DOCX files to Markdown. The result includes the document body, individual pages, and separate headers, footers, comments, and tracked changes.

[Try the DOCX to Markdown demo](https://docx-to-markdown.docx-editor.dev/) or read the [Markdown export guide](https://www.docx-editor.dev/docs/2.x/export/markdown).

## Before you begin

For Node.js, use version 20.16.0 or later in the 20.x release line, or version 22.3.0 or later. The converter requires WebAssembly and uses bundled fonts by default.

## Install the package

```sh
npm install @docx-editor.dev/docx-to-markdown @docx-editor.dev/core
```

`@docx-editor.dev/core` is a required peer dependency. Install a version that satisfies the converter's peer dependency range and commit your lockfile.

## Convert a DOCX file

The following example reads a local file in Node.js:

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const docxBytes = await readFile('document.docx');
const result = await exportMarkdown(docxBytes);
console.log(result.markdown);
```

## Include images

Set `images: true` to include image links and extracted bytes:

```ts
const result = await exportMarkdown(docxBytes, { images: true });
```

`result.media` contains image bytes and their page occurrences. See [image workflows](docs/images.md) to save a folder, download a ZIP, or return hosted URLs.

### Preserve displayed image sizes

Use `images: { syntax: 'html' }` to include each image's displayed width and height in generated `<img>` tags. Dimensions use whole CSS pixels. Configure your Markdown renderer to allow sanitized HTML and retain `width` and `height`. The default `images: true` uses standard Markdown image syntax, which has no size attributes. For custom previews, use each occurrence's `displayWidthPx` and `displayHeightPx`. Asset `pixelWidth` and `pixelHeight` describe the image file's dimensions. Crop, rotation, and floating text wrapping are not reproduced. See [displayed image sizes and custom previews](docs/images.md#preserve-displayed-image-sizes).

## Read page output

The document layout engine calculates page breaks.

```ts
for (const page of result.pages) {
  console.log(page.number, page.markdown);
  console.log(page.headerMarkdown, page.footerMarkdown);
}
```

`result.markdown` joins the body into one document. Headers and footers stay in `result.pages`.

For search and AI ingestion, use `{ displayMode: 'proposed' }` to show pending insertions and hide pending deletions. The default, `'all-markup'`, shows both.

## Configure fonts for accurate layout

Fonts determine line wrapping, table row heights, and the page boundaries in `result.pages`. Markdown does not preserve the DOCX font family, but the converter needs font measurements to calculate layout.

Start with the bundled substitutes for common Word fonts. Use `fonts` to supply the author's licensed fonts or override a substitute. Use `fallbackFonts: googleFonts()` to load missing faces from Google Fonts; it requires network access and does not override faces already resolved by earlier sources.

See [font setup and troubleshooting](docs/fonts.md) for runnable examples, resolution reports, and guidance on matching page references to Word.

## Runtime and output

For Next.js, use the Node.js runtime and [server package configuration](docs/integrations.md#nextjs). Edge runtimes are not supported.

Page breaks depend on fonts, document features, and revision mode; they can differ from Microsoft Word. Store the document version with page citations. `result.warnings` reports omitted content and font problems. Images are omitted unless enabled. See [output limits](docs/api.md#markdown-limitations) before using the output as a complete transcription.

The package uses the Apache 2.0 license, including comment and tracked-change extraction. Bundled fonts retain their own open-source licenses.

## Next steps

- [Configure fonts and troubleshoot page layout](docs/fonts.md).
- [Include and deliver images](docs/images.md).
- [Connect the converter to your application](docs/integrations.md).
- [Review export options and result fields](docs/api.md).
