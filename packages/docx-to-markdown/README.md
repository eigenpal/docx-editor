# DOCX to Markdown

Convert DOCX to Markdown in one call. Get the full document and individual pages, including separate headers, footers, comments, and tracked changes.

[Try the demo](https://docx-to-markdown.docx-editor.dev/) · [Integrations](docs/integrations.md) · [API reference](docs/api.md)

```sh
npm install @docx-editor.dev/docx-to-markdown
```

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const docxBytes = await readFile('document.docx');
const result = await exportMarkdown(docxBytes);
console.log(result.markdown);
```

## Keep images

Set `images: true` to include image links and extracted bytes:

```ts
const result = await exportMarkdown(docxBytes, { images: true });
```

`result.media` contains image bytes and their page occurrences.
See [image workflows](docs/images.md) to save a folder, download a ZIP, or return hosted URLs.

### Preserve image sizes

Use `images: { syntax: 'html' }` to include each image's displayed width and height in generated `<img>` tags.
Dimensions use whole CSS pixels. Configure your Markdown renderer to allow sanitized HTML and retain `width` and `height`.
The default `images: true` uses standard Markdown image syntax, which has no size attributes.
For custom previews, use each occurrence's `displayWidthPx` and `displayHeightPx`.
Asset `pixelWidth` and `pixelHeight` describe the image file's dimensions.
Crop, rotation, and floating text wrapping are not reproduced.
See [displayed image sizes and custom previews](docs/images.md#preserve-displayed-image-sizes).

## Keep the page numbers

The document layout engine calculates page breaks.

```ts
for (const page of result.pages) {
  console.log(page.number, page.markdown);
  console.log(page.headerMarkdown, page.footerMarkdown);
}
```

`result.markdown` joins the body into one document. Headers and footers stay in `result.pages`.

For search and AI ingestion, use `{ displayMode: 'proposed' }` to show pending insertions and hide pending deletions. The default, `'all-markup'`, shows both.

## Runtime and output

Runs in Node.js with bundled fonts and WebAssembly. Next.js uses the Node.js runtime and [server package configuration](docs/integrations.md#nextjs). Edge runtimes are not supported.

Page breaks depend on fonts, document features, and revision mode; they can differ from Microsoft Word. Store the document version with page citations. `result.warnings` reports omitted content and font problems. Images are omitted unless enabled. See [output limits](docs/api.md#markdown-limitations) before using the output as a complete transcription.

Apache-2.0, including comment and tracked-change extraction. Bundled fonts retain their own open-source licenses.
