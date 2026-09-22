# Integrate PDF conversion

The converter runs on Node.js and returns PDF bytes. Keep conversion on the server for browser applications. The package remains private under the EigenPal Pro License. The following examples assume your application already has access to the package.

## Return a PDF response

A Node.js route can return the bytes in a web `Response`. This handler accepts raw DOCX bytes, not multipart form data:

```ts
import {
  exportPdf,
  ExportResourceError,
  PdfDocumentOpenError,
  PdfFidelityError,
  PdfOutputLimitError,
  PdfPageLimitError,
} from '@docx-editor.dev/docx-to-pdf';

export async function POST(request: Request): Promise<Response> {
  try {
    const source = new Uint8Array(await request.arrayBuffer());
    const result = await exportPdf(source, {
      signal: request.signal,
      timeoutMs: 30_000,
      maxPages: 100,
      maxOutputBytes: 16 * 1024 * 1024,
      useSystemFonts: false,
    });
    return new Response(new Uint8Array(result.bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="document.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof PdfDocumentOpenError) {
      return Response.json({ error: error.code }, { status: 422 });
    }
    if (error instanceof PdfFidelityError) {
      return Response.json({ error: error.code }, { status: 422 });
    }
    if (error instanceof PdfPageLimitError || error instanceof PdfOutputLimitError) {
      return Response.json({ error: error.code }, { status: 413 });
    }
    if (error instanceof ExportResourceError && error.code === 'timedOut') {
      return Response.json({ error: error.code }, { status: 504 });
    }
    throw error;
  }
}
```

Configure your server's request size limit before `request.arrayBuffer()` reads the body. The output byte limit does not limit uploaded bytes. Set a concurrency limit appropriate for your available memory.

## Next.js

Use `export const runtime = 'nodejs'` in the route file. Place the handler in `app/api/convert/route.ts`.

Keep packages external so Node.js resolves their font and WebAssembly assets:

```js
// next.config.mjs
export default {
  serverExternalPackages: [
    '@docx-editor.dev/docx-to-pdf',
    '@docx-editor.dev/core',
    '@docx-editor.dev/fonts',
  ],
};
```

If you deploy a standalone bundle, include the converter's `assets/` directory and the fonts package's assets. Keep the package directory structure intact. Test the deployment artifact with a real conversion before release.

## Convert a batch

Process a batch sequentially when memory use matters more than throughput:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { exportPdf } from '@docx-editor.dev/docx-to-pdf';

for (const name of ['first', 'second']) {
  const source = await readFile(`${name}.docx`);
  const result = await exportPdf(source, { useSystemFonts: false });
  await writeFile(`${name}.pdf`, result.bytes);
}
```

The exporter disposes its document session after each call, including failed calls. For repeated exports or both formats from one layout, use [a reusable PDF session](markdown-contract.md#reuse-one-session).

## Runtime checks

From this repository, validate packed Node.js consumers with:

```sh
bun run build:pdf
bun run --filter '@docx-editor.dev/docx-to-markdown' build
bun run --filter '@docx-editor.dev/docx-to-pdf' check:consumer
```

The check installs local tarballs in a temporary directory outside the workspace. It compiles TypeScript consumers and runs conversion through the built package. This check needs registry access for external dependencies.
