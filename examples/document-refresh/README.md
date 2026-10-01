# DOCX document refresh example

Receive complete DOCX files without replacing the open editor. Preserve scroll position and show temporary highlights with change summaries.

## Run the example

From the repository root, run:

```bash
bun install
bun run build:packages
bun run dev:refresh
```

Open `http://localhost:5177`.

## Try the workflow

1. Scroll the document and select **Simulate server updates**. Two cumulative files update the delivery date and review date.
2. Inspect **Review changes**. Footer and deletion summaries remain visible without highlight locations. The mock also reports one failed processor operation.
3. Select **Show change** to navigate to an available location. Highlights disappear after five seconds.
4. Request another update. Each request captures a fresh submission and receives two more files.
5. Enable **Deliver an older result after the latest update**. The controller refuses that result with `out-of-order`.
6. Reset the example, request updates, and select **Cancel updates**. Accepted changes remain in the document.
7. Reset again and type during processing. The controller refuses replacement and preserves your edit.

## How it works

`runRefreshJob()` captures the document, submits its bytes, checks response identity, applies cumulative results, and finishes the submission. It stops after a refused replacement, except for late results. It finishes the submission after transport failures. Cancellation stops the network request and invalidates pending controller work.

The server generates controlled sample files. It discards uploaded bytes and does not edit arbitrary documents. Reset after manual edits. A production processor must edit the captured file and preserve earlier successful changes.

The review list includes processor descriptions and location diagnostics. These summaries do not create revisions. Highlights mark body paragraphs and remain outside saved content.

Each accepted file resets selection and undo history. Refresh refuses collaborative sessions. Use the document API for agent edits that require native suggestions or collaboration.

For options and failure handling, see [Document refresh API](https://docx-editor.dev/docs/2.x/guides/document-refresh).
