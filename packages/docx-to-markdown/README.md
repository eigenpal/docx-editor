# `@docx-editor.dev/docx-to-markdown`

> Private workspace package. Not available on npm.

Convert DOCX to Markdown with page boundaries, headers, footers, and review metadata.
No browser or DOM required.

## Quick start

Run `bun dev:markdown` from the repository root to try the editor and Markdown preview.
Within this workspace, use `workspace:*` as the dependency version.

Use `exportMarkdown` to convert DOCX bytes. It manages layout and session cleanup:

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const bytes = new Uint8Array(await readFile('document.docx'));
const { pages, fontResolution } = await exportMarkdown(bytes);

for (const family of fontResolution?.families ?? []) {
  if (family.coverage !== 'complete') {
    console.warn(`Incomplete font-face coverage: ${family.family}`);
  }
}

for (const page of pages) {
  console.log(`Page ${page.number} (page id: ${page.id})`);
  console.log(page.headerMarkdown);
  console.log(page.markdown);
  console.log(page.footerMarkdown);
}
```

For public release, replace this private banner and workspace demo quick start with public
installation and usage instructions. Remove the package from Changesets `ignore`, choose its
version, align the Core and fonts dependency versions, then remove `private: true`.

## Public interface

```ts
exportMarkdown(
  source: Uint8Array | HeadlessDocumentView,
  options?: MarkdownExportOptions
): Promise<MarkdownExportResult>;

openDocumentForExport(
  source: Uint8Array | HeadlessDocumentView,
  options?: OpenMarkdownDocumentForExportOptions
): Promise<OpenMarkdownDocumentForExportResult>;

exportMarkdownFrom(
  session: ExportSession
): Promise<MarkdownExportResult>;

exportMarkdownLayout(layout: ExportSemanticLayout): MarkdownExportResult;
```

Use `exportMarkdown` for a single export. To reuse or inspect a layout, use
`openDocumentForExport` and `exportMarkdownFrom`. To convert a layout after disposing its session,
use `exportMarkdownLayout`.

### Result shape

```ts
interface MarkdownExportResult {
  /** Primary output: physical page projections with page furniture and provenance. */
  readonly pages: readonly MarkdownPage[];
  /** All comments and tracked changes, including artifacts without a page occurrence. */
  readonly reviewArtifacts: readonly MarkdownReviewArtifact[];
  /** Offsets and artifact IDs valid only within this immutable result. */
  readonly reviewBindings: readonly MarkdownReviewBinding[];
  /** Structured font evidence, or null when the layout's font origin is unavailable. */
  readonly fontResolution: ExportFontResolutionReport | null;
  /** How this result's pages and revision content were produced. */
  readonly pagination: {
    readonly source: 'layout-engine';
    readonly scope: 'export-snapshot';
    readonly layoutRevision: number;
    readonly displayMode: 'all-markup' | 'proposed' | 'original';
  };
  /** Convenience logical, full-document Markdown. */
  readonly markdown: string;
}

interface MarkdownPage {
  /** Identifier for this page within this export result. */
  readonly id: string;
  /** One-based physical page number. */
  readonly number: number;
  /** Body content and page-local note definitions or continuations. */
  readonly markdown: string;
  /** Header and footer are separate from logical document content. */
  readonly headerMarkdown: string;
  readonly footerMarkdown: string;
  /** Membership views: complete artifacts with at least one occurrence on this page. */
  readonly comments: readonly MarkdownComment[];
  readonly trackedChanges: readonly MarkdownTrackedChange[];
}

interface MarkdownReviewBinding {
  readonly artifactId: string;
  readonly artifactKind: 'comment' | 'tracked-change';
  readonly occurrenceIndex: number;
  readonly coverage: 'complete' | 'partial' | 'none';
  readonly projection:
    | { readonly kind: 'document' }
    | {
        readonly kind: 'page';
        readonly pageIndex: number;
        readonly pageNumber: number;
        readonly field: 'markdown' | 'headerMarkdown' | 'footerMarkdown';
      };
  readonly ranges: readonly {
    readonly start: number;
    readonly end: number;
    readonly unit: 'utf16-code-unit';
    readonly precision: 'exact' | 'containing-construct';
  }[];
  readonly unmappedReason?:
    | 'not-represented-in-markdown'
    | 'non-linear-structural-change'
    | 'omitted-story-content';
}
```

`fontResolution` lists requested families, resolved and substituted faces, coverage
(`complete`, `partial`, or `none`), and nonfatal `originFailures`. Document-aware byte sessions
return this report. Reusable sessions also expose it as `session.fontResolution`.
It is `null` for detached layouts, custom measurers, ordinary Core sessions, and live views
using shared shaping. Fatal failures throw `DocumentOpenError` or `ExportResourceError`.

`pages` contains the page output from the editor's layout engine. Page numbers and IDs apply
only to this export. Different fonts or Microsoft Word versions can produce different page breaks.

`pagination` records the layout source, export scope, Core revision, and tracked-change display mode.

For citations that must survive storage or document updates, retain your own document version or
content hash alongside the page number. For example:

```ts
const citation = {
  documentVersion: contract.sha256,
  engineVersion: applicationBuild.docxEditorVersion,
  pageNumber: result.pages[11]!.number,
  pageId: result.pages[11]!.id,
  pagination: result.pagination,
};
```

`result.markdown` contains the whole document. It joins content split across pages and excludes
repeated headers and footers. Use `pages` when you need page citations.

### Comments and tracked changes

Comments and revision metadata are returned separately from Markdown.
Review IDs are opaque and valid only within one export. For stored citations, include your own
document version or content hash.

`page.comments` and `page.trackedChanges` contain complete artifacts with occurrences on that page.
Their `occurrences` can include other pages. Filter them to avoid double counting:

```ts
const localComments = page.comments.flatMap((artifact) =>
  artifact.occurrences
    .filter(({ physicalPageNumber }) => physicalPageNumber === page.number)
    .map((occurrence) => ({ artifact, occurrence }))
);
```

Page artifacts can occur in the body, headers, footers, footnotes, endnotes, or note separators.
`result.reviewArtifacts` contains all artifacts, including those without a page occurrence.

`result.reviewBindings` connects each occurrence to offsets in `result.markdown`,
`page.markdown`, `page.headerMarkdown`, or `page.footerMarkdown`. Offsets use JavaScript UTF-16
string indexing and can be passed directly to `slice()`:

```ts
for (const binding of result.reviewBindings) {
  const output =
    binding.projection.kind === 'document'
      ? result.markdown
      : result.pages[binding.projection.pageIndex]![binding.projection.field];

  for (const range of binding.ranges) {
    console.log(output.slice(range.start, range.end));
  }
}
```

For source-aligned edits, require `coverage === 'complete'` and `precision === 'exact'`.
For citations or display, you can use partial or `containing-construct` bindings if you retain
that precision information. Unmapped artifacts include an `unmappedReason`.

Artifact IDs, occurrence indexes, page IDs, and offsets are valid only within this export.

Tracked changes also participate in layout through `displayMode`: `all-markup` (default) keeps
inserted and deleted text visible, `proposed` shows the accepted view, and `original` shows the
rejected view. There is no reviewer/author filtering in this API.

## Options

`MarkdownExportOptions` contains layout and resource controls for the export snapshot.

| Option                  | Meaning                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `displayMode`           | Tracked-change projection: `all-markup` (default), `proposed`, or `original`.                 |
| `signal`                | Aborts resource waits and later layout work.                                                  |
| `resourceTimeoutMs`     | Deadline applied separately to initial font provisioning and each layout resource wait.       |
| `reuseAcrossRevisions`  | Retains state for live/caller-measured sessions; document-aware byte sessions reject `true`.  |
| `fonts`                 | Font configuration or resolver. Earlier entries win. Requires immutable DOCX bytes.           |
| `fallbackFonts`         | Fallback after bundled fonts. Requires DOCX bytes. Accepts `googleFonts()`.                   |
| `fontPolicy`            | `best-effort` (default), or `strict` to require all four static faces and no origin failures. |
| `onFontResolution`      | Receives the font-resolution report.                                                          |
| `measurer`              | Custom text measurer. Overrides font resolution.                                              |
| `producer`              | Stable identity for a host-owned measurer and its cache entries.                              |
| `imageDecodePort`       | Custom image metadata decoder. Defaults to the Node.js decoder.                               |
| `convertPreservedImage` | Converts preserved EMF, WMF, or TIFF bytes to a supported raster format.                      |

### Tracked changes

To show the document with changes accepted, set `displayMode` to `proposed`.
Review artifacts remain available:

```ts
const proposed = await exportMarkdown(bytes, {
  displayMode: 'proposed',
});
```

## Reuse an export session

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

Always call `dispose()` on reusable sessions to release caches and pending resource work.
Repeated calls are safe. Live views can retain state across revisions; byte sources use
one-shot caching by default.

For a single export, use `exportMarkdown(bytes)`. To keep a layout without retaining session
resources, obtain it before disposal, then pass it to `exportMarkdownLayout`. Layouts remain
valid after disposal.

## Images

Images affect page boundaries but are omitted from Markdown. There is no image URL callback.
If omitting an inline image would join words, the exporter inserts a space.

## Errors and cancellation

For malformed or unsupported DOCX input, `exportMarkdown` throws `DocumentOpenError`.
`openDocumentForExport` returns `{ ok: false, reason, detail }` instead.

Both workflows can throw `ExportResourceError` with one of these codes:

- `aborted`, `timedOut`, `nonConvergent`, or `disposed`.
- `layoutInvariant`: document geometry exceeds the engine's page model.
- `layoutFailed`: another layout or host integration failure.

The layout errors retain the original diagnostic as `cause`.
Aborting a reusable session releases its resources and prevents reuse. Calling `dispose()`
afterward is safe.

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

## Layout and fonts

Core resolves fonts, images, document geometry, and `displayMode` before pagination.
Markdown uses that immutable layout. There is no separate page-width override.
`signal` and `resourceTimeoutMs` cover resource processing.

Fonts resolve in this order:

1. Your `fonts` configuration or resolvers; earlier entries take priority.
2. Bundled substitutes from `@docx-editor.dev/fonts`.
3. Optional `fallbackFonts`.

The Node.js defaults use HarfBuzz and packaged substitutes: Carlito for Calibri, Caladea for
Cambria, Liberation Serif for Times New Roman, Liberation Sans for Arial, and Liberation Mono
for Courier New. These fonts require no network requests.

For accurate pagination, supply the author's licensed fonts, use `fontPolicy: 'strict'`,
save the font-resolution report, and pin the exporter, Core, and font catalog versions.
The default `best-effort` policy uses approximate measurements for unresolved fonts.

To enable Google Fonts as a fallback, pass `googleFonts()` through `fallbackFonts`.
It uses a pinned catalog and verified content hashes. Requests disclose requested font families
to the CDN:

```ts
import { readFile } from 'node:fs/promises';
import { googleFonts } from '@docx-editor.dev/fonts/google';
import {
  createFontSource,
  exportMarkdown,
  type ExportFontResolutionReport,
} from '@docx-editor.dev/docx-to-markdown';

const faceSpecs = [
  ['Aptos.ttf', 400, 'normal'],
  ['Aptos-Bold.ttf', 700, 'normal'],
  ['Aptos-Italic.ttf', 400, 'italic'],
  ['Aptos-BoldItalic.ttf', 700, 'italic'],
] as const;

const sources = [];
for (const [file, weight, style] of faceSpecs) {
  const admitted = createFontSource(new Uint8Array(await readFile(file)), {
    family: 'Aptos',
    weight,
    style,
  });
  if ('failure' in admitted)
    throw new Error(admitted.failure.diagnostic ?? admitted.failure.reason);
  sources.push(admitted.source);
}

let fontReport: ExportFontResolutionReport | undefined;

const result = await exportMarkdown(bytes, {
  fonts: { sources },
  // Consulted only for faces application fonts and bundled substitutes cannot paint.
  fallbackFonts: googleFonts({ onFailure: (failure) => console.error(failure) }),
  fontPolicy: 'strict',
  onFontResolution: (report) => {
    fontReport = report;
  },
});
```

Omit `fallbackFonts` to use only your fonts and bundled substitutes. For network-free exports,
your own resolvers must also use local data.

Custom `fonts` and `fallbackFonts` require immutable DOCX bytes. For a live `HeadlessDocumentView`,
use a host-owned, revision-stable `measurer` with a stable `producer`. A custom measurer takes
precedence and bypasses both font options.

`fontPolicy: 'strict'` rejects origin failures or missing regular, bold, italic, or bold-italic
faces. Use `onFontResolution` to record resolved and substituted faces, and
`googleFonts({ onFailure })` to log fallback failures. More than 64 candidate families causes
`layoutFailed`. Failed or aborted Google Fonts requests are not cached.

### Font limits

The package exports these limits:

- `HARD_MAX_FONT_BYTES`: 64 MiB per face.
- `HARD_MAX_FONT_SOURCES`: 256 sources per composition.
- `HARD_MAX_AGGREGATE_FONT_BYTES`: 128 MiB per composition and across active document font leases.

Invalid or oversized origins are reported and skipped. Exceeding the process-wide lease budget
causes `layoutFailed`. Return only requested faces from resolvers, limit concurrent exports,
and dispose reusable sessions promptly. Use the exported constants in your code.

Document-embedded fonts are admitted after explicit origins, using the same mapper as the browser editor.
Regular, bold, italic, and bold-italic embedded faces must pass the shared font limits.

## Markdown limitations

- Use `pages` for page output and `markdown` for the whole document.
- Page headers and footers are returned separately per page.
- Merged table cells are flattened.
- GFM has no nested-table construct. Nested tables alone use plain inline `<table>`, `<tr>`,
  `<td>`, and `<th>` HTML on one line, so strict sanitizers (including GitHub's) keep the
  structure and inline Markdown inside each cell remains parseable.
- Images affect layout but are omitted from Markdown.
- Anchored text-box text is omitted because it has no unambiguous linear position; comments and
  tracked changes inside it remain available as page artifacts with exact text-box provenance.
- Office Math uses the core semantic equation fallback.
- A note continued without its reference is emitted as a labeled continuation block in page
  Markdown.
