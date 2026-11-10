# Vite DOCX editor example

This Vite and React app shows the editor composition API with custom chrome.

The demo combines `packagedFonts()` with `googleFonts()`. Packaged substitutes load first. A document can cause CDN requests for other declared font families.

## Run the example

From the repository root, run:

```bash
bun install
bun run dev:react
```

Open `http://localhost:5173`.

The default document is `public/sample.docx`. In development, `?fixture=<name>.docx` resolves a file with that name from `e2e/fixtures/`. Production builds include only the fixtures listed in `vite.config.ts`.

## Add the editor to Vite

Install the adapter and its engine peer:

```bash
npm install @docx-editor.dev/react @docx-editor.dev/core
```

Import `@docx-editor.dev/core/styles/editor.css` once in your application entry. Then render the editor:

```tsx
import '@docx-editor.dev/core/styles/editor.css';
import { useRef } from 'react';
import { DocxEditor, type DocxEditorRef } from '@docx-editor.dev/react';

function Editor({ file }: { file: ArrayBuffer }) {
  const editorRef = useRef<DocxEditorRef>(null);

  const handleSave = async () => {
    const buffer = await editorRef.current?.save();
    if (buffer) await fetch('/api/documents/1', { method: 'PUT', body: buffer });
  };

  return <DocxEditor ref={editorRef} document={file} onSave={handleSave} />;
}
```

`document` takes an `ArrayBuffer`, a `Uint8Array`, or an existing `DocumentHandle`. The editor loads embedded fonts without a resolver.

Pass usable font bytes for accurate measurement. Without them, fallback measurement does not guarantee faithful DOCX layout. Use `packagedFonts()` for local substitutes. `googleFonts()` opts your application into CDN requests.

## Configure production delivery

Build the app before measuring startup. The development server does not represent production delivery.

Enable Brotli compression on your server or content delivery network (CDN). Keep gzip available for clients without Brotli support. Serve JavaScript, CSS, font, and WebAssembly files with their correct content types. Do not set `Content-Encoding: br` unless the response body contains Brotli-compressed bytes.

Vercel negotiates compression automatically through the request's `Accept-Encoding` header. It does not need an application compression switch. For more information, see [Vercel CDN compression](https://vercel.com/docs/how-vercel-cdn-works/compression).

Give content-hashed assets this response header:

```http
Cache-Control: public, max-age=31536000, immutable
```

Apply this policy only to existing content-hashed files. A broad path rule can also cache fallback HTML for missing assets. HTML must revalidate so visitors receive links to the latest assets. Do not apply immutable caching to user documents, API responses, or files with reusable names.

Check an actual asset response with an explicit Brotli request:

```sh
curl -sS -D - -o /dev/null \
  -H 'Accept-Encoding: br' \
  'https://your-domain.example/react/assets/your-built-file.js'
```

Confirm `Content-Encoding: br` and the expected `Cache-Control` value in the response. Check the HTML response separately. Server configuration, rather than an editor prop, controls these headers.

For an empty document, pass `document="blank"` instead of fetching a DOCX file. Use `packagedFonts()` to load the document's required font families. Do not preload every font family. Early font requests can compete with the JavaScript that displays the editor.

Measure editor display and document font readiness separately. Lighthouse can report the surrounding page's heading as its largest contentful paint. A page performance score alone does not establish editor readiness.

## Build custom chrome

`src/ComposedEditorDemo.tsx` uses the editor primitives and hooks directly.

```tsx
<DocxEditor.Root document={bytes}>
  <YourHeader />
  <DocxEditor.Toolbar t={t} />
  <DocxEditor.Viewport>
    <DocxEditor.Content />
  </DocxEditor.Viewport>
</DocxEditor.Root>
```

For more information, see the [React adapter guide](https://www.docx-editor.dev/docs/2.x/react).

## Review changes in batches

Open `http://localhost:5173/?bulkReview=1&fixture=bulk-review.docx` after running `bun run dev:react` from the repository root. Filter by author or select individual changes, then accept or reject them. Check the skipped-change report and try **Undo**, **Redo**, and **Save and reopen**. The main-story API controls use `RevisionCollection.resolve()` without a selection, so they include changes hidden by the editor filter.

Run the browser checks with:

```sh
bunx playwright test --config e2e/editor-smoke.config.ts bulk-review.interaction.spec.ts
```

See [Resolve a batch of changes](../../docs/site/content/editor-api/revisions.mdx) for selection, result handling, and strict batches.

## Edit textboxes

Open `http://localhost:5173/?textboxes=1` to load the anonymous textbox sample. Click inside the box to edit its text. Click its border to select, drag, or resize it. Use **Undo**, **Redo**, and **Save** to inspect the result. Table and header textboxes remain read-only. Use **Insert → Text Box** to add an empty box and start typing.

The demo uses the default `<DocxEditor.Toolbar />` appearance, including the font picker and spacing. Applications do not need demo-specific toolbar CSS.
