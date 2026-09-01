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
const { pages } = await exportMarkdown(bytes);

for (const page of pages) {
  console.log(`Page ${page.number} (snapshot id: ${page.id})`);
  console.log(page.headerMarkdown);
  console.log(page.markdown);
  console.log(page.footerMarkdown);
}
```

The package is private in this change and cannot be installed from the public registry yet.
Inside this monorepo, depend on it with `workspace:*`.

The final release step must remove the package from Changesets `ignore`, choose the public version,
align the `@docx-editor.dev/core` and `@docx-editor.dev/fonts` version floors with that release, and
only then remove `private: true`. Repository tests intentionally reject a partial release state.

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
  /** Primary output: physical page projections with page furniture and provenance. */
  readonly pages: readonly MarkdownPage[];
  /** All comments and tracked changes, including records without a page occurrence. */
  readonly reviewArtifacts: readonly MarkdownReviewArtifact[];
  /** Machine-readable scope of these page citations. */
  readonly pagination: {
    readonly basis: 'docx-editor-layout';
    readonly stability: 'snapshot';
    readonly wordCompatibility: 'not-guaranteed';
    readonly layoutRevision: number;
    readonly displayMode: 'all-markup' | 'proposed' | 'original';
  };
  /** Convenience logical, full-document Markdown. */
  readonly markdown: string;
}

interface MarkdownPage {
  /** Snapshot-local identity; changes when the document repaginates. */
  readonly id: string;
  /** One-based physical page number. */
  readonly number: number;
  /** Body content and page-local note definitions or continuations. */
  readonly markdown: string;
  /** Header and footer are separate from logical document content. */
  readonly headerMarkdown: string;
  readonly footerMarkdown: string;
  /** Review artifacts physically occurring in body, furniture, or notes on this page. */
  readonly comments: readonly MarkdownComment[];
  readonly trackedChanges: readonly MarkdownTrackedChange[];
}
```

`pages` is the primary interface. Page boundaries come from the same layout engine that renders
the editor; they are not inferred from `w:lastRenderedPageBreak` or approximated after Markdown
conversion. This is the appropriate shape for engine-snapshot citations such as “page 12”,
legal/compliance review, retrieval chunks tied to one rendered snapshot, and page-aware agent
workflows.

Pagination metadata describes how one result was produced; it does **not** identify the source
document or render configuration. Persist a caller-owned immutable document version (or content
hash), the relevant render configuration/engine version, and the page number together. For example:

```ts
const citation = {
  documentVersion: contract.sha256,
  engineVersion: applicationBuild.docxEditorVersion,
  pageNumber: result.pages[11]!.number,
  pageSnapshotId: result.pages[11]!.id,
  pagination: result.pagination,
};
```

The engine computes layout pages rather than reading stale page-break hints, but this private
preview does not claim byte-for-byte desktop Word parity: missing document-embedded fonts, font
substitutions, and renderer differences can change breaks. `page.id` and `layoutRevision` are
snapshot-local, not durable document identifiers. A public Word-parity benchmark and stricter
fidelity diagnostics are release gates, not assumptions hidden behind authoritative-looking page
numbers.

`result.markdown` is a convenience projection for consumers that only need one conventional
Markdown document. It joins split records and excludes repeated page furniture, so it deliberately
cannot preserve page provenance.

### Comments and tracked changes

Each page carries the comments and tracked changes that physically occur in its body, header,
footer, footnotes, endnotes, or authored note separator. One artifact can occur on multiple pages:
a range can cross a page boundary, and a change in a shared header can be rendered on every page.
Inspect `artifact.occurrences` when the exact story and source range matter.

`result.reviewArtifacts` is the authoritative document-wide list. It also retains orphaned comments
and other records that have no physical page occurrence, so page-local processing does not silently
lose review data.

```ts
const result = await exportMarkdown(bytes);

for (const page of result.pages) {
  for (const comment of page.comments) {
    console.log(`Comment ${comment.id} appears on page ${page.number}: ${comment.text}`);
  }
  for (const change of page.trackedChanges) {
    console.log(`${change.change} by ${change.author} on page ${page.number}`);
  }
}

const orphanedComments = result.reviewArtifacts.filter(
  (artifact) => artifact.kind === 'comment' && artifact.orphaned
);
```

## Options

`MarkdownExportOptions` combines layout/session options with the Markdown image callback.

| Option                  | Meaning                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| `displayMode`           | Tracked-change projection: `all-markup` (default), `proposed`, or `original`.                  |
| `image`                 | Synchronous mapping from a laid-out drawing to `{ url }` or `{ skip: true }`.                  |
| `signal`                | Aborts resource waits and later layout work.                                                   |
| `resourceTimeoutMs`     | Maximum resource-settlement time for one layout call; default `60_000`.                        |
| `reuseAcrossRevisions`  | Retains incremental state for a live view; defaults to `true` for views and `false` for bytes. |
| `measurer`              | Host-owned text measurer. Omit to use packaged fonts and shared HarfBuzz shaping.              |
| `producer`              | Stable identity for a host-owned measurer and its cache entries.                               |
| `imageDecodePort`       | Host image metadata decoder. Omit for the bounded Node decoder.                                |
| `convertPreservedImage` | Converts preserved EMF, WMF, or TIFF bytes to a supported raster format.                       |

### Tracked changes

The default keeps all pending changes visible in Markdown. A whole-document resolved view must be
requested explicitly. The artifact list remains available as provenance; this option controls the
whole-document revision projection.

```ts
const proposed = await exportMarkdown(bytes, {
  displayMode: 'proposed',
});
```

## Reusing an export session

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdownFrom, openDocumentForExport } from '@docx-editor.dev/docx-to-markdown';

const bytes = new Uint8Array(await readFile('document.docx'));
const opened = await openDocumentForExport(bytes, {
  displayMode: 'all-markup',
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
  console.log(first.pages.length === second.pages.length);
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
import {
  exportMarkdownFrom,
  forEachSemanticDrawing,
  openDocumentForExport,
} from '@docx-editor.dev/docx-to-markdown';

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

The one-shot `exportMarkdown` API throws `DocumentOpenError` for malformed or unsupported DOCX
input. Use `openDocumentForExport` when control flow should inspect its typed `{ ok: false,
reason, detail }` result instead. Layout or resource processing can throw `ExportResourceError`
with `code` equal to `aborted`, `timedOut`, `nonConvergent`, `disposed`, `layoutInvariant`, or
`layoutFailed` in either workflow. `layoutInvariant` means recognized authored geometry could not
be represented within the engine's bounded page model. `layoutFailed` identifies another engine
or host-integration failure, such as an unavailable custom measurer. Both retain the original
diagnostic as the standard `cause` without making consumers import a layout implementation type.

```ts
import {
  DocumentOpenError,
  ExportResourceError,
  exportMarkdown,
} from '@docx-editor.dev/docx-to-markdown';

const controller = new AbortController();

try {
  const result = await exportMarkdown(bytes, {
    signal: controller.signal,
    resourceTimeoutMs: 30_000,
  });
  console.log(result.markdown);
} catch (error) {
  if (error instanceof DocumentOpenError) {
    console.error(error.reason, error.detail);
  } else if (error instanceof ExportResourceError) {
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

- Physical Word-layout pages are first-class; flattened `markdown` is secondary.
- Page headers and footers are returned separately per page.
- Comments and tracked changes are normalized by core and exposed globally and per physical page.
- Merged table cells are flattened.
- Positioned anchored images are appended after their owning story body in stable record order.
- Anchored text-box text is omitted because it has no unambiguous linear position; comments and
  tracked changes inside it remain available as page artifacts with exact text-box provenance.
- Office Math uses the core semantic equation fallback.
- A note continued without its reference is emitted as a labelled continuation block in page
  Markdown.

Browser and headless export use the same core layout coordinator. Core projection and layout
improvements therefore flow into Markdown automatically. Compile-time policy ratchets require a
new semantic record field or kind to be represented or explicitly classified as callback-exposed,
layout-only, or omitted; focused output tests remain the behavioral authority.
