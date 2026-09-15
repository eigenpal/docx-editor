# DOCX to Markdown API reference

Use this reference to choose an export function, configure conversion, and inspect the result.
For installation and a first export, see the [package quickstart](../README.md).

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
  session: ExportSession,
  options?: MarkdownProjectionOptions
): Promise<MarkdownExportResult>;

exportMarkdownLayout(layout: ExportSemanticLayout): MarkdownExportResult;
```

Use `exportMarkdown` for a single export. To reuse or inspect a layout, use `openDocumentForExport` and `exportMarkdownFrom`. To convert a layout after disposing its session, use `exportMarkdownLayout`.

### Result shape

```ts
interface MarkdownExportResult {
  /** Unique extracted assets, or [] when images are disabled. */
  readonly media: readonly MarkdownImageAsset[];
  /** Omitted content and font problems. */
  readonly warnings: readonly MarkdownWarning[];
  /** Primary output: physical page projections with page furniture and provenance. */
  readonly pages: readonly MarkdownPage[];
  /** All comments and tracked changes, including artifacts without a page occurrence. */
  readonly reviewArtifacts: readonly MarkdownReviewArtifact[];
  /** Offsets and artifact IDs valid only within this immutable result. */
  readonly reviewBindings: readonly MarkdownReviewBinding[];
  /** Font families and faces used for pagination, or null when the layout's font origin is unavailable. */
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

`fontResolution` lists requested families, resolved and substituted faces, coverage (`complete`, `partial`, or `none`), and nonfatal `originFailures`. Document-aware byte sessions return this report. Reusable sessions also expose it as `session.fontResolution`. It is `null` for detached layouts, custom measurers, ordinary Core sessions, and live views using shared shaping. Fatal failures throw `DocumentOpenError` or `ExportResourceError`.

`pages` contains the page output from the editor's layout engine. Page numbers and IDs apply only to this export. Different fonts or Microsoft Word versions can produce different page breaks.

`pagination` records the layout source, export scope, Core revision, and tracked-change display mode.

For citations that must survive storage or document updates, retain your own document version or content hash alongside the page number. For example:

```ts
const citation = {
  documentVersion: contract.sha256,
  engineVersion: applicationBuild.docxEditorVersion,
  pageNumber: result.pages[11]!.number,
  pageId: result.pages[11]!.id,
  pagination: result.pagination,
};
```

`result.markdown` contains the whole document. It joins content split across pages and excludes repeated headers and footers. Use `pages` when you need page citations.

### Comments and tracked changes

The exporter returns comments and revision metadata separately from Markdown. Review IDs are opaque and valid only within one export. For stored citations, include your own document version or content hash.

`page.comments` and `page.trackedChanges` contain complete artifacts with occurrences on that page. Their `occurrences` can include other pages. Filter them to avoid double counting:

```ts
const localComments = page.comments.flatMap((artifact) =>
  artifact.occurrences
    .filter(({ physicalPageNumber }) => physicalPageNumber === page.number)
    .map((occurrence) => ({ artifact, occurrence }))
);
```

Page artifacts can occur in the body, headers, footers, footnotes, endnotes, or note separators. `result.reviewArtifacts` contains all artifacts, including those without a page occurrence.

`result.reviewBindings` connects each occurrence to offsets in `result.markdown`, `page.markdown`, `page.headerMarkdown`, or `page.footerMarkdown`. Offsets use JavaScript UTF-16 string indexing and can be passed directly to `slice()`:

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

For source-aligned edits, require `coverage === 'complete'` and `precision === 'exact'`. For citations or display, you can use partial or `containing-construct` bindings if you retain that precision information. Existing bindings with no mapped ranges include an `unmappedReason`.

Artifacts without occurrences have no bindings or `unmappedReason`. These include orphan comments and comments entirely hidden by the selected revision mode. Inspect `result.reviewArtifacts` as well as `result.reviewBindings` to retain them.

Artifact IDs, occurrence indexes, page IDs, and offsets are valid only within this export.

Tracked changes also participate in layout through `displayMode`: `all-markup` (default) keeps inserted and deleted text visible, `proposed` includes pending insertions and hides pending deletions, and `original` hides pending insertions and shows pending deletions. Revision mode applies to the whole document.

## Images and portable delivery

Enable `images: true` for relative image links and `result.media` bytes. Use `{ images: { resolveUrl, maxTotalBytes } }` for custom delivery. The default extracted-byte limit is 64 MiB; image extraction is opt-in. `exportMarkdownFrom(session, options)` accepts the same image options and an abort signal.

Set `images: { syntax: 'html' }` to emit `<img>` tags with each occurrence's displayed width and height in whole CSS pixels.
The default `syntax: 'markdown'` emits standard image links without size attributes.
Your renderer must support sanitized HTML and retain `width` and `height`.
Occurrences expose exact `displayWidthPx`, `displayHeightPx`, and `kind` (`inline` or `anchored`).
Asset `pixelWidth` and `pixelHeight` describe the image bytes, not their displayed size.
Crop, rotation, and floating text wrapping are not reproduced.

`createMarkdownZip(result)` and `toMarkdownJSON(result)` are exported from the main package. `writeMarkdownBundle(result, { directory })` comes from `@docx-editor.dev/docx-to-markdown/node`. See [image APIs, errors, ownership, and runnable workflows](images.md).

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

`fontPolicy` and `onFontResolution` require immutable DOCX bytes with the default document-aware font resolution. Both options throw `TypeError` when used with a live `HeadlessDocumentView` or combined with a custom `measurer`, including an explicit `fontPolicy: 'best-effort'`.

### Tracked changes

To show the proposed text, set `displayMode` to `proposed`. This changes the export projection; it does not accept changes in the DOCX. Review artifacts remain available:

```ts
const proposed = await exportMarkdown(docxBytes, {
  displayMode: 'proposed',
});
```

## Reuse an export session

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdownFrom, openDocumentForExport } from '@docx-editor.dev/docx-to-markdown';

const docxBytes = await readFile('document.docx');
const opened = await openDocumentForExport(docxBytes, {
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

Call `dispose()` on reusable sessions to release caches and pending resource work. Repeated calls are safe. Live views can retain state across revisions; byte sources use one-shot caching by default.

For a single export, use `exportMarkdown(docxBytes)`. To keep a layout without retaining session resources, obtain it before disposal, then pass it to `exportMarkdownLayout`. Layouts remain valid after disposal.

## Images

Images affect page boundaries and are omitted from Markdown unless you enable `images`. If omitting an inline image would join words, the exporter inserts a space.

## Errors and cancellation

For malformed or unsupported DOCX input, `exportMarkdown` throws `DocumentOpenError`. `openDocumentForExport` returns `{ ok: false, reason, detail }` instead.

Both workflows throw `TypeError` for unsupported combinations of [export options](#options), such as a custom `measurer` combined with `fontPolicy` or `onFontResolution`.

Both workflows can throw `ExportResourceError` with one of these codes:

- `aborted`, `timedOut`, `nonConvergent`, or `disposed`.
- `layoutInvariant`: document geometry exceeds the engine's page model.
- `layoutFailed`: another layout or host integration failure.

The layout errors retain the original diagnostic as `cause`. Aborting a reusable session releases its resources and prevents reuse. Calling `dispose()` afterward is safe.

```ts
import {
  DocumentOpenError,
  ExportResourceError,
  exportMarkdown,
} from '@docx-editor.dev/docx-to-markdown';

const controller = new AbortController();

try {
  const result = await exportMarkdown(docxBytes, {
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

Core resolves fonts, images, document geometry, and `displayMode` before pagination. Markdown uses that immutable layout. `signal` and `resourceTimeoutMs` cover resource processing.

See [Configure fonts for Markdown layout](fonts.md) for resolution order, bundled substitutes, separate Google Fonts and custom-font examples, strict mode, and troubleshooting.

Custom `fonts` and `fallbackFonts` require immutable DOCX bytes. For a live `HeadlessDocumentView`, use a host-owned, revision-stable `measurer` with a stable `producer`. A custom measurer takes precedence and bypasses both font options. Omit `fontPolicy` and `onFontResolution` when using a custom measurer or live view; these combinations throw `TypeError`.

Use `onFontResolution` to observe resolved and substituted faces. The exporter does not await callback promises. Callback errors are logged without failing the export. To wait for report storage, save `result.fontResolution` after export and await that operation.

Use `googleFonts({ onFailure })` to log fallback failures. Failed or aborted Google Fonts requests are not cached.

### Font limits

The package exports these limits:

- `HARD_MAX_FONT_BYTES`: 64 MiB per face.
- `HARD_MAX_FONT_SOURCES`: 256 sources per composition.
- `HARD_MAX_AGGREGATE_FONT_BYTES`: 128 MiB per composition and across active document font leases.

Invalid or oversized origins are reported and skipped. Exceeding the process-wide lease budget causes `layoutFailed`. Return only requested faces from resolvers, limit concurrent exports, and dispose reusable sessions promptly. Use the exported constants in your code.

Document-embedded fonts are admitted after caller fonts, bundled substitutes, and optional fallback origins, using the same mapper as the browser editor. Regular, bold, italic, and bold-italic embedded faces must pass the shared font limits.

## Warnings

`result.warnings` contains `{ code, message, pageNumber?, partName? }` objects. Codes are stable; messages are for display. `pageNumber` is one-based when present.

| Code                 | Meaning                                                              |
| -------------------- | -------------------------------------------------------------------- |
| `omitted-drawing`    | Images or shapes are omitted.                                        |
| `omitted-textbox`    | Text box content is omitted.                                         |
| `font-origin-failed` | A font source failed to load.                                        |
| `content-scan-limit` | Source inspection reached its bound; additional omissions may exist. |
| `incomplete-font`    | A requested family lacks one or more faces; pagination may differ.   |

Drawing warnings are grouped by category and page, including headers, footers, and notes. Unsupported legacy images, shapes, and text boxes are reported from the source package with `partName`, without a page number. Each warning identifies omitted content.

## Markdown limitations

- Use `pages` for page output and `markdown` for the whole document.
- Page headers and footers are returned separately per page.
- Merged table cells are flattened.
- Nested tables use inline HTML (`<table>`, `<tr>`, `<td>`, and `<th>`). Cells retain inline Markdown.
- Images affect layout. They are omitted by default; `images: true` includes supported images and returns their bytes.
- Anchored text-box text is omitted because it has no unambiguous linear position; comments and tracked changes inside it remain available as page artifacts with exact text-box provenance.
- Office Math uses the core semantic equation fallback.
- A note continued without its reference is emitted as a labeled continuation block in page Markdown.

## See also

- [Image extraction and delivery](images.md).
- [Application integrations](integrations.md).
