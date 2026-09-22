# DOCX to PDF demo

A local demo of PDF support: edit a Word document on the left, and generate a PDF on the right.

## Run the example

From the repository root, run:

```bash
bun install
bun run dev:pdf
```

Open `http://127.0.0.1:5180`.

## Use the demo

The demo opens the editor sample. Edit it, then select **Generate PDF** to convert the document as it stands. The preview appears beside the editor with a download link.

The demo converts in best-effort mode, so a document that names a font this host does not have, or draws a shape the writer does not support, still produces pages. The line under the pages counts the diagnostics. Select it to read each one with the pages it applies to.

Conversion runs when you ask for it, not on every keystroke, because a page of PDF is expensive to produce. After an edit, the demo marks the preview stale. The page count line says so, and the control becomes **Regenerate PDF**.

**Open DOCX** loads a document of your own, up to 20 MiB. **Reset** returns to the sample.

## How the server works

The Node server hosts the React UI and `/api/convert`. Conversion runs in a worker with a 60-second deadline and a bounded heap, one conversion at a time. A request that arrives while another conversion runs receives 503. Uploads stay in memory, and are limited to 20 MiB. The server retains neither the uploaded document nor the converted PDF, and it binds to loopback. To change the port, set `PORT`.

The hosted demo converts through a server function with the same upload limit, deadline, and one-at-a-time rule per instance. Its memory ceiling is the function's own, and a document beyond it is refused with 507. It accepts a request only when its `Origin` header matches the host, so only the demo page can use it. The local server also accepts requests without an `Origin` header, so a command-line client can exercise it during development.

The heap ceiling is 512 MiB, set with `WORKER_HEAP_MB`. A 521-page document converts in about 17 seconds and peaks near 380 MiB of old space. The same document fails below about 448 MiB. A document that needs more than the ceiling receives 507, with a message that names the limit. The host is not exhausted.

The exporter runs only on Node, because `@docx-editor.dev/docx-to-pdf` reads installed font files through `node:fs`. The browser therefore posts the document to the server rather than converting in the page.

For a local production build, run:

```sh
bun run build:pdf
bun run --filter './examples/docx-to-pdf' build
bun run --filter './examples/docx-to-pdf' start
```

## Verification

Run the following command to verify the server:

```sh
node --test examples/docx-to-pdf/server.node.test.mjs
```

The test covers conversion, refusal, busy handling, cancellation, and recovery. It runs on Node rather than Bun, because it drives a real HTTP server and a `node:worker_threads` worker built from a `data:` URL. The repository runner dispatches `.node.test.mjs` files accordingly.
