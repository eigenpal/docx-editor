# Integrate DOCX to Markdown

Before you begin, [install the converter and check the runtime requirements](../README.md#before-you-begin). Use `result.markdown` for text and `result.pages` for page citations. See [image delivery](images.md) for browser ZIP downloads, local folders, and server URLs with JSON metadata.

## LangChain

Install the packages, then create one LangChain document for each exported page:

```sh
npm install @docx-editor.dev/docx-to-markdown @docx-editor.dev/core @langchain/core
```

Convert the file and map its pages to LangChain documents:

```ts
import { readFile } from 'node:fs/promises';
import { Document } from '@langchain/core/documents';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const filename = 'contract.docx';
const docxBytes = await readFile(filename);
const result = await exportMarkdown(docxBytes, { displayMode: 'proposed' });
const documents = result.pages.map(
  (page) =>
    new Document({
      pageContent: page.markdown,
      metadata: { source: filename, page: page.number },
    })
);
```

Pass `documents` to your splitter or vector store. Preserve page metadata when splitting, and add a document version or content hash before storing citations. Review `result.warnings` for omitted content or incomplete fonts.

## Other ingestion pipelines

Use this converter for DOCX files in a MarkItDown, Docling, or Unstructured pipeline. Map each page to a text record with source and page metadata.

```ts
const records = result.pages.map((page) => ({
  text: page.markdown,
  metadata: { source: filename, page: page.number },
}));
```

Map these fields to your pipeline's document schema. For Python applications, use the [Python package](../../../python/docx-to-markdown/README.md).

## Next.js

Keep the packages external so Node.js can load their bundled font and WebAssembly files. This configuration works with both Webpack and Turbopack.

```js
// next.config.mjs
export default {
  serverExternalPackages: [
    '@docx-editor.dev/docx-to-markdown',
    '@docx-editor.dev/core',
    '@docx-editor.dev/fonts',
  ],
};
```

Add a route handler that converts DOCX bytes and returns JSON:

```ts
// app/api/convert/route.ts
import {
  DocumentOpenError,
  exportMarkdown,
  toMarkdownJSON,
} from '@docx-editor.dev/docx-to-markdown';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const result = await exportMarkdown(new Uint8Array(await request.arrayBuffer()), {
      displayMode: 'proposed',
      signal: request.signal,
      resourceTimeoutMs: 15_000,
    });
    return Response.json(toMarkdownJSON(result));
  } catch (error) {
    if (error instanceof DocumentOpenError) {
      return Response.json({ error: 'Document could not be opened' }, { status: 422 });
    }
    throw error;
  }
}
```

The example buffers the request. Apply authentication and upload limits before reading the body, and handle resource failures through your application's error handling. `toMarkdownJSON` excludes binary image bytes; if you enable images, deliver their assets separately or use a ZIP.

With your development server running, send a local DOCX file and save the response:

```sh
curl --fail-with-body http://localhost:3000/api/convert \
  -H 'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document' \
  --data-binary @contract.docx \
  --output contract.json
```

For self-hosted standalone output, add `output: 'standalone'` to your Next.js configuration and retain the traced package assets. See [Next.js serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).

## Serverless functions and worker threads

Use a Node.js runtime that allows WebAssembly and includes the packages' font and WASM assets. The converter uses bundled fonts by default. See [font setup](fonts.md) to configure remote fallback or local custom fonts.

`resourceTimeoutMs` limits resource waits, including font provisioning. It is not a deadline for the whole conversion. Parsing and layout run synchronously; `AbortSignal` cannot interrupt JavaScript that is already running. For a hard deadline, run conversion in a worker thread and terminate the worker on timeout. Limit upload size and concurrent conversions to fit your deployment's memory budget.

Next.js Edge is unsupported. Validate the production bundle, font coverage, and page counts on your target platform before deployment.

## Next steps

- [Deliver image files and JSON metadata](images.md).
- [Configure export options and handle errors](api.md).
