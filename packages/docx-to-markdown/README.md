# `@docx-editor.dev/docx-to-markdown`

> Private workspace package. Publishing is intentionally deferred to the final release step.

Server-first DOCX-to-Markdown conversion powered by the same semantic layout engine as the
browser editor, PDF, and future exporters. It requires no DOM, browser, editor instance, or CLI.

## Quick start

The one-shot API accepts DOCX bytes, opens and lays out the document, translates it, and disposes
its internal session.

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const bytes = new Uint8Array(await readFile('document.docx'));
const result = await exportMarkdown(bytes);

console.log(result.markdown);
```

The package is private in this change and cannot be installed from the public registry yet.
Inside this monorepo, depend on it with `workspace:*`.

## Public interface

```ts
exportMarkdown(
  source: Uint8Array | HeadlessDocumentView,
  options?: MarkdownExportOptions
): Promise<MarkdownExportResult>;

openDocumentForExport(
  source: Uint8Array | HeadlessDocumentView,
  options?: OpenDocumentForExportOptions
): Promise<OpenDocumentForExportResult>;

exportMarkdownFrom(
  session: ExportSession,
  options?: MarkdownTranslationOptions
): Promise<MarkdownExportResult>;
```

`exportMarkdown` is the usual entry point. `openDocumentForExport` and `exportMarkdownFrom` are
for workflows that need to reuse one settled layout, inspect semantic records, pre-process
images, or share the same layout with another exporter.

### Result shape

```ts
interface MarkdownExportResult {
  /** Logical, full-document Markdown. */
  readonly markdown: string;
  /** Physical page projections, including page furniture. */
  readonly pages: readonly MarkdownPage[];
}

interface MarkdownPage {
  /** One-based physical page number. */
  readonly number: number;
  /** Body content and page-local note definitions or continuations. */
  readonly markdown: string;
  /** Header and footer are separate from logical document content. */
  readonly headerMarkdown: string;
  readonly footerMarkdown: string;
}
```

Use `result.markdown` for a conventional Markdown document. Use `result.pages` when the consumer
must preserve physical page boundaries or render headers and footers.

## Options

`MarkdownExportOptions` combines layout/session options with the Markdown image callback.

| Option                  | Meaning                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `displayMode`           | Tracked-change projection: `all-markup` (default), `proposed`, or `original`.                                                   |
| `hiddenRevisionAuthors` | Reviewer names whose revisions are projected as accepted across body, headers/footers, notes, tables, drawings, and text boxes. |
| `image`                 | Synchronous mapping from a laid-out drawing to `{ url }` or `{ skip: true }`.                                                   |
| `signal`                | Aborts resource waits and later layout work.                                                                                    |
| `resourceTimeoutMs`     | Maximum resource-settlement time for one layout call; default `60_000`.                                                         |
| `reuseAcrossRevisions`  | Retains incremental state for a live view; defaults to `true` for views and `false` for bytes.                                  |
| `measurer`              | Host-owned text measurer. Omit to use packaged fonts and shared HarfBuzz shaping.                                               |
| `producer`              | Stable identity for a host-owned measurer and its cache entries.                                                                |
| `imageDecodePort`       | Host image metadata decoder. Omit for the bounded Node decoder.                                                                 |
| `convertPreservedImage` | Converts preserved EMF, WMF, or TIFF bytes to a supported raster format.                                                        |

### Tracked changes and reviewers

The default keeps all pending changes visible. A resolved view must be requested explicitly.

```ts
const proposed = await exportMarkdown(bytes, {
  displayMode: 'proposed',
});

const hideAdaMarkup = await exportMarkdown(bytes, {
  displayMode: 'all-markup',
  hiddenRevisionAuthors: ['Ada Lovelace'],
});
```

`hiddenRevisionAuthors` does not mutate or accept revisions in the DOCX. It changes only this
layout projection. Hidden reviewers use the accepted projection; every other reviewer continues
to follow `displayMode`.

## Reusing an export session

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdownFrom, openDocumentForExport } from '@docx-editor.dev/docx-to-markdown';

const bytes = new Uint8Array(await readFile('document.docx'));
const opened = await openDocumentForExport(bytes, {
  displayMode: 'all-markup',
  hiddenRevisionAuthors: ['Ada Lovelace'],
});

if (!opened.ok) {
  throw new Error(
    `DOCX was refused: ${opened.reason}${opened.detail ? ` (${opened.detail})` : ''}`
  );
}

try {
  // Resource settlement and layout are cached by the session.
  const layout = await opened.session.layout();
  console.log(`Pages: ${layout.pages.length}`);

  const first = await exportMarkdownFrom(opened.session);
  const second = await exportMarkdownFrom(opened.session);
  console.log(first.markdown === second.markdown);
} finally {
  opened.session.dispose();
}
```

Always dispose a reusable session. `dispose()` is idempotent and releases document caches and
pending resource work. A live `HeadlessDocumentView` can retain incremental state across document
revisions; immutable byte sources default to one-shot cache ownership.

## Images

Without an `image` mapper, a drawing emits only its escaped accessibility label. The mapper is
synchronous. Upload or persist validated media before translation, then return a precomputed URL.
Returning a Promise is rejected instead of emitting a broken destination.

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import { forEachSemanticDrawing } from '@docx-editor.dev/core/layout';
import { exportMarkdownFrom, openDocumentForExport } from '@docx-editor.dev/docx-to-markdown';

const opened = await openDocumentForExport(bytes);
if (!opened.ok) throw new Error(`DOCX was refused: ${opened.reason}`);

try {
  const layout = await opened.session.layout();
  const urls = new WeakMap<object, string>();
  const writes: Promise<void>[] = [];
  let index = 0;

  await mkdir('public/docx-media', { recursive: true });
  forEachSemanticDrawing(layout, ({ drawing }) => {
    const media = opened.session.validatedImageBytes(drawing);
    if (!media) return;
    const name = `image-${++index}.bin`;
    urls.set(drawing, `/docx-media/${name}`);
    writes.push(writeFile(`public/docx-media/${name}`, media));
  });
  await Promise.all(writes);

  const result = await exportMarkdownFrom(opened.session, {
    image: (drawing) => {
      const url = urls.get(drawing);
      return url ? { url } : { skip: true };
    },
  });
  console.log(result.markdown);
} finally {
  opened.session.dispose();
}
```

`validatedImageBytes` returns a defensive copy only for a ready drawing belonging to that
session. Choose a file extension from your own media pipeline; the example uses `.bin` only to
avoid guessing a format.

EMF, WMF, and TIFF remain labelled placeholders by default because Node cannot decode them
without a format-specific dependency. `convertPreservedImage` receives the preserved MIME type,
resource limits, and session abort signal.

## Errors and cancellation

Use `openDocumentForExport` when a caller needs a typed refusal for malformed or unsupported DOCX
input. Resource settlement can throw `ExportResourceError` with `code` equal to `aborted`,
`timedOut`, `nonConvergent`, or `disposed`.

```ts
import { ExportResourceError, exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const controller = new AbortController();

try {
  const result = await exportMarkdown(bytes, {
    signal: controller.signal,
    resourceTimeoutMs: 30_000,
  });
  console.log(result.markdown);
} catch (error) {
  if (error instanceof ExportResourceError) {
    console.error(error.code, error.message);
  } else {
    throw error;
  }
}
```

## Layout and Markdown policy

The Node defaults use the metric-compatible faces from `@docx-editor.dev/fonts`, shared HarfBuzz
shaping, bounded image-header decoding, and the core export session. Pass `measurer` only when
host-owned metrics are intentional, and pair it with a stable `producer`.

Document-embedded fonts are not automatically admitted by the Node defaults yet. A DOCX that
depends on `w:embedRegular`, `w:embedBold`, `w:embedItalic`, or `w:embedBoldItalic` is affected.
Those documents can paginate differently from the browser editor, which auto-wires those faces.
Logical full-document Markdown remains independent of page breaks.

Markdown is a semantic degradation:

- Page headers and footers are returned separately per page.
- Merged table cells are flattened.
- Positioned anchored images are emitted in stable record order.
- Anchored text boxes are omitted because they have no unambiguous linear position.
- Office Math uses the core semantic equation fallback.
- A note continued without its reference is emitted as a labelled continuation block in page
  Markdown.

Browser and headless export use the same core layout coordinator. Core projection and layout
improvements therefore flow into Markdown automatically. Compile-time policy ratchets require a
new semantic record field or kind to be represented or explicitly classified as callback-exposed,
layout-only, or omitted; focused output tests remain the behavioral authority.
