# DOCX to PDF demo

A local demo of PDF support: edit a Word document on the left, generate a PDF on the right.

Run `bun run dev:pdf` from the repository root, then open `http://127.0.0.1:5180`.

## Using it

The demo opens the editor sample. Edit it, then select **Generate PDF** to convert the document as it currently stands. The preview appears beside the editor with a download link.

Conversion runs when you ask for it, not on every keystroke: a page of PDF is expensive to produce. After an edit the preview is marked stale, the page count line says so, and the control becomes **Regenerate PDF**.

**Open DOCX** loads a document of your own, up to 20 MiB. **Reset** returns to the sample.

## How it is served

The Node server hosts the React UI and `/api/convert`. Conversion runs in a worker with a 60-second deadline and a bounded heap, one at a time; a request arriving while another is running receives 503. Uploads stay in memory and are limited to 20 MiB. The server retains neither the uploaded document nor the converted PDF, binds to loopback, and is not configured for public deployment. Set `PORT` to change the port.

The heap ceiling is 512 MiB, set with `WORKER_HEAP_MB`. A 521-page document converts in about 17 seconds and peaks near 380 MiB of old space; the same document fails below about 448 MiB. A document that needs more than the ceiling receives 507 with a message that names the limit, rather than exhausting the host.

The exporter is Node-only, which is why the browser posts the document to the server rather than converting in the page: `@docx-editor.dev/docx-to-pdf` reads installed font files through `node:fs`.

For a local production build:

```sh
bun run build:pdf
bun run --filter './examples/docx-to-pdf' build
bun run --filter './examples/docx-to-pdf' start
```

## Verification

```sh
node --test examples/docx-to-pdf/server.node.test.mjs
```

The test covers conversion, refusal, busy handling, cancellation, and recovery. It runs on Node rather than Bun — it drives a real HTTP server and a `node:worker_threads` worker built from a `data:` URL — and the repository runner dispatches `.node.test.mjs` files accordingly.
