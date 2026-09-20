# Local DOCX-to-PDF demo

Run `bun run dev:pdf` from the repository root, then open `http://127.0.0.1:5180`. The Node server serves the React UI and `/api/convert`.

The demo defaults to strict conversion, final text, and native PDF comments. Unsupported content produces an explanation and an explicit best-effort retry. The browser previews the resulting PDF and provides a download link.

For a local production build:

```sh
bun run build:pdf
bun run --filter './examples/docx-to-pdf' build
bun run --filter './examples/docx-to-pdf' start
```

Set `PORT` to change the port. The server binds to loopback. Each conversion runs in a worker with a 60-second deadline and a 512 MiB JavaScript heap limit. Only one conversion can run at a time; excess requests receive 503. Uploads are limited to 20 MiB and remain in memory. The server does not retain uploaded documents or converted PDFs. This example does not configure public deployment.

Run `node --test examples/docx-to-pdf/server.node.test.mjs` after building the packages to verify conversion, refusal, busy handling, cancellation, and recovery.
