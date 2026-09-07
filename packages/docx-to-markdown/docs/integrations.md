# Integrations

Use `result.markdown` for text and `result.pages` for page citations.

## LangChain

```sh
npm install @docx-editor.dev/docx-to-markdown @langchain/core
```

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

Map these fields to your pipeline's document schema. For Python applications, expose the Node.js converter through a service that returns JSON.

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

```ts
// app/api/convert/route.ts
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const docxBytes = new Uint8Array(await request.arrayBuffer());
  const result = await exportMarkdown(docxBytes, { signal: request.signal });
  return Response.json(result);
}
```

Send the DOCX as the request body. Apply your application's upload limits and error handling. For self-hosted standalone output, add `output: 'standalone'`; retain the traced package assets. See [Next.js serverExternalPackages](https://nextjs.org/docs/app/api-reference/config/next-config-js/serverExternalPackages).

## Serverless and workers

Use a Node.js runtime that allows WebAssembly and includes the packages' font and WASM assets. The converter uses bundled fonts by default. Configure `fallbackFonts` to use remote fonts.

`resourceTimeoutMs` limits resource waits, including font provisioning. It is not a deadline for the whole conversion. Parsing and layout run synchronously; `AbortSignal` cannot interrupt JavaScript that is already running. For a hard deadline, run conversion in a worker thread and terminate the worker on timeout. Limit upload size and concurrent conversions to fit your deployment's memory budget.

Next.js Edge is unsupported. Validate the production bundle, font coverage, and page counts on your target platform before deployment.
