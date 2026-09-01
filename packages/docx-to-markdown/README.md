# `@docx-editor.dev/docx-to-markdown`

> Private workspace package. Publishing is intentionally deferred to the final release step.

Server-first DOCX-to-Markdown conversion powered by the same semantic layout engine as the
browser editor, PDF, and future exporters. It requires no DOM, browser, editor instance, or CLI.

## Quick start

To try the private package from this workspace, run `bun dev:markdown`. The standalone demo opens
the real paginated editor beside a live page-by-page GFM preview, supports upload and drag/drop,
and re-exports the current DOCX after edits.

The one-shot API accepts DOCX bytes, opens and lays out the document, translates it, and disposes
its internal session.

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const bytes = new Uint8Array(await readFile('document.docx'));
const { pages } = await exportMarkdown(bytes);

for (const page of pages) {
  console.log(`Page ${page.number} (page id: ${page.id})`);
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
  options?: OpenMarkdownDocumentForExportOptions
): Promise<OpenDocumentForExportResult>;

exportMarkdownFrom(
  session: ExportSession,
  options?: MarkdownTranslationOptions
): Promise<MarkdownExportResult>;

exportMarkdownLayout(
  layout: ExportSemanticLayout,
  options?: MarkdownTranslationOptions
): MarkdownExportResult;
```

`exportMarkdown` is the usual entry point. It disposes its producer session after layout and
translates the detached immutable snapshot, keeping the one-shot memory lifecycle bounded.
`openDocumentForExport` and `exportMarkdownFrom` are for workflows that need to reuse one settled
layout, inspect semantic records, pre-process images, or share the same layout with another
exporter. `exportMarkdownLayout` translates a snapshot after its session has been disposed.

### Result shape

```ts
interface MarkdownExportResult {
  /** Primary output: physical page projections with page furniture and provenance. */
  readonly pages: readonly MarkdownPage[];
  /** All comments and tracked changes, including records without a page occurrence. */
  readonly reviewArtifacts: readonly MarkdownReviewArtifact[];
  /** Stable links from review occurrences to generated Markdown strings. */
  readonly reviewBindings: readonly MarkdownReviewBinding[];
  /** How this result's pages and revision content were produced. */
  readonly pagination: {
    readonly source: 'layout-engine';
    readonly scope: 'export-snapshot';
    readonly layoutRevision: number;
    readonly revisionView: 'all-markup' | 'proposed' | 'original';
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
  /** Review artifacts physically occurring in body, furniture, or notes on this page. */
  readonly comments: readonly MarkdownComment[];
  readonly trackedChanges: readonly MarkdownTrackedChange[];
}

interface MarkdownReviewBinding {
  readonly artifactId: string;
  readonly artifactKind: 'comment' | 'tracked-change';
  /** Index into the matching artifact's occurrences array. */
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

`pages` is the primary interface. Page boundaries come from the same layout engine that renders
the editor; they are not inferred from `w:lastRenderedPageBreak` or approximated after Markdown
conversion. This is the appropriate shape for page citations such as “page 12”, legal/compliance
review, retrieval chunks tied to one rendered result, and page-aware agent workflows.

`pagination.source` confirms that pages came from the layout engine. `pagination.scope` means the
page numbers describe this returned export. `layoutRevision` identifies the Core document state,
and `revisionView` says whether tracked changes were shown as markup, proposed content, or original
content.

Page IDs and numbers are local to this returned export; do not use them as permanent document
identifiers. They reflect the same Core layout the editor uses, but are not a certification that a
particular Microsoft Word build with a different font installation will produce identical breaks.

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

`result.markdown` is a convenience projection for consumers that only need one conventional
Markdown document. It joins split records and excludes repeated page furniture, so it deliberately
cannot preserve page provenance.

### Comments and tracked changes

Each page carries the comments and tracked changes that physically occur in its body, header,
footer, footnotes, endnotes, or authored note separator. One artifact can occur on multiple pages:
a range can cross a page boundary, and a change in a shared header can be rendered on every page.
`page.comments` and `page.trackedChanges` are membership views: each entry is the complete
document-wide artifact, so its `occurrences` array can also contain occurrences on other pages.
Filter by `occurrence.pageIndex === page.number - 1` when the exact page-local story and DOCX
source range matter.

`result.reviewArtifacts` is the authoritative document-wide list. It also retains orphaned comments
and other records that have no physical page occurrence, so page-local processing does not silently
lose review data.

`result.reviewBindings` connects those source occurrences to UTF-16 offsets in `result.markdown`,
`page.markdown`, `page.headerMarkdown`, or `page.footerMarkdown`. The exporter creates bindings
while it serializes, so escaping, repeated text, links, tables, lists, and page splits cannot make
them ambiguous. Use the offsets directly with JavaScript `slice()`:

```ts
for (const binding of result.reviewBindings) {
  const output =
    binding.projection.kind === 'document'
      ? result.markdown
      : result.pages[binding.projection.pageIndex]![binding.projection.field];

  const selected = binding.ranges.map(({ start, end }) => output.slice(start, end)).join('');

  console.log(binding.artifactId, selected, binding.coverage, binding.unmappedReason);
}
```

One source range may produce several Markdown ranges when Markdown delimiters or page boundaries
split it. `coverage` says whether all, some, or none of the Core source occurrence is represented.
A range has `precision: 'exact'` when its source boundaries map exactly to output boundaries, even
when escaping changes the generated text or its length.
Generated atoms such as image Markdown, note references, and equation fallbacks use
`'containing-construct'`, meaning the range selects the smallest complete Markdown construct that
represents the source. Textbox content and structural changes can have no honest linear Markdown
range; those bindings carry `omitted-story-content` or `non-linear-structural-change` while the
complete artifact and Core source provenance remain in `reviewArtifacts`.
`not-represented-in-markdown` is the fallback for other source content that has no honest linear
Markdown representation.

For source-aligned edits, require `coverage === 'complete'` and every range to have
`precision === 'exact'`. Citation and display workflows can still use partial or
`containing-construct` bindings while showing their declared fidelity.

Ordinary Markdown stays clean: comments and revision metadata are not injected as HTML comments,
CriticMarkup, or visible footnotes. Presentation-oriented review markup can be added later as an
explicit option without changing the default output or the lossless sidecar contract.

```ts
const result = await exportMarkdown(bytes);

for (const page of result.pages) {
  for (const comment of page.comments) {
    const localOccurrences = comment.occurrences.filter(
      (occurrence) => occurrence.pageIndex === page.number - 1
    );
    console.log(
      `Comment ${comment.id} appears ${localOccurrences.length} time(s) on page ${page.number}: ${comment.text}`
    );
  }
  for (const change of page.trackedChanges) {
    const localOccurrences = change.occurrences.filter(
      (occurrence) => occurrence.pageIndex === page.number - 1
    );
    console.log(
      `${change.change} by ${change.author} appears ${localOccurrences.length} time(s) on page ${page.number}`
    );
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
| `resourceTimeoutMs`     | Deadline applied separately to initial font provisioning and each layout resource wait.        |
| `reuseAcrossRevisions`  | Retains incremental state for a live view; defaults to `true` for views and `false` for bytes. |
| `fonts`                 | Caller configuration/resolver, first-wins; requires immutable DOCX-byte input.                 |
| `fallbackFonts`         | Opt-in origins after bundled substitutes; requires bytes; use for `googleFonts()`.             |
| `fontPolicy`            | `best-effort` (default), or `strict` to require all four static faces and no origin failures.  |
| `onFontResolution`      | Receives requested, direct/substituted, unresolved, and failed-origin evidence.                |
| `measurer`              | Host-owned text measurer; when present it takes precedence over all font origins.              |
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

If only one projection is needed, prefer `exportMarkdown(bytes)`. A reusable session deliberately
retains source, resource, and alternate-display-mode state. To inspect or share a layout without
retaining that producer state, finish any `validatedImageBytes` reads, dispose the session, then
pass the already-published layout to `exportMarkdownLayout`. Published layouts are immutable
snapshots and remain valid after disposal.

## Images

Without an `image` mapper, a drawing emits only its escaped accessibility label. The mapper is
synchronous. Upload or persist validated media before translation, then return a precomputed URL.
Returning a Promise is rejected instead of emitting a broken destination.

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import {
  exportMarkdownLayout,
  forEachSemanticDrawing,
  openDocumentForExport,
} from '@docx-editor.dev/docx-to-markdown';

const opened = await openDocumentForExport(bytes);
if (!opened.ok) throw new Error(`DOCX was refused: ${opened.reason}`);

const { layout, urls } = await (async () => {
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
    return { layout, urls };
  } finally {
    opened.session.dispose();
  }
})();

const result = exportMarkdownLayout(layout, {
  image: (drawing) => {
    const url = urls.get(drawing);
    return url ? { url } : { skip: true };
  },
});
console.log(result.markdown);
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
Aborting the caller signal is terminal for a reusable session and immediately runs its idempotent
resource teardown, including pending image work and document-specific font leases. Calling
`dispose()` afterward remains safe.

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

### Export fidelity contract

Pagination is created in Core before Markdown translation. The export lane must therefore settle
every input that can change geometry before it asks for a layout snapshot:

- DOCX page geometry, section breaks, margins, columns, styles, theme mappings, run font family,
  run font size, weight, italic state, character spacing, scaling, and line spacing come from the
  immutable document snapshot. There is intentionally no Markdown-only page-width override.
- Font origins are resolved in `fonts` → bundled substitutes → `fallbackFonts` order. Core measures
  every run at its resolved OOXML size. It shapes a run with admitted bytes when its face resolves
  and uses the deterministic fixed measurer for that run otherwise; Markdown never measures text
  or invents page breaks after the fact.
- Images and preserved-format conversion settle through the same bounded Core session before the
  semantic layout is published. `signal` and `resourceTimeoutMs` cover that work.
- `displayMode` is applied by Core before pagination, so inserted/deleted content and page fields
  are measured in the same revision view reported by `pagination.revisionView`.
- The resulting layout is immutable. Markdown, PDF, and future translators must consume that one
  snapshot rather than reopening the DOCX or re-resolving fonts independently.

For citation-sensitive production exports, supply the same licensed font files used by the author
through `fonts`, use `fontPolicy: 'strict'`, persist `onFontResolution` with the job record, and pin
the exporter/Core/font-catalog versions. Only complete strict coverage establishes that every
requested static face used font-backed shaping. In `best-effort`, any family reported as `partial`
or `none` can use Core's deterministic approximate measurer for unresolved runs; if no source is
admitted, the whole layout uses it rather than losing the document. That fallback is bounded and
reproducible, but it is not a high-fidelity pagination claim.

The Node defaults use the packaged, validated metric-compatible faces from
`@docx-editor.dev/fonts` with shared HarfBuzz shaping: Calibri → Carlito, Cambria → Caladea, Times
New Roman → Liberation Serif, Arial → Liberation Sans, and Courier New → Liberation Mono. These
open faces are selected for matching layout metrics and require no runtime Google Fonts request.

For higher fidelity, pass licensed or application-owned faces through `fonts`. The value can be a
Core font configuration, a marked on-demand resolver, or an ordered list; earlier entries win.
The exporter parses the DOCX first, asks resolvers only for the bounded family list used by the
body, styles, headers, footers, and notes, then lays out once with the settled HarfBuzz measurer.
Bundled Word-compatible substitutes fill any gaps after caller fonts.

Google Fonts is an explicit last resort because it performs network requests and can disclose the
font families a document uses to the CDN. Opt in with `fallbackFonts`; the resolver uses a closed,
commit-pinned catalog and content hashes rather than constructing URLs from DOCX text:

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

Omit `fallbackFonts` for a network-free export. Supply only `fallbackFonts: googleFonts()` when
there are no application-owned faces. If a host already owns a complete measurement stack, pass
`measurer` with a stable `producer`; that explicit measurer takes precedence over font origins.
Custom `fonts` and `fallbackFonts` are accepted only with immutable DOCX bytes. A live
`HeadlessDocumentView` may change between resolution and layout, so export it with the host's
revision-stable `measurer`; when `measurer` is present, neither font-origin option is invoked.

For audit-sensitive jobs, route `googleFonts({ onFailure })` failures into job diagnostics and
supply licensed/application faces in `fonts` for every required family. `fontPolicy: 'strict'`
refuses the export if an origin failed or any requested family lacks regular, bold, italic, or
bold-italic coverage; `onFontResolution` records the direct and substituted faces that produced
the page breaks. Documents whose candidate catalog exceeds the safe 64-family resolver boundary
also fail with a typed `layoutFailed` error instead of silently dropping a face. Google fallback is
opt-in, uses a bounded process cache, and a timeout or abort never leaves a failed request cached.

Font admission is deliberately bounded against hostile or unexpectedly large inputs. The public
`HARD_MAX_FONT_BYTES`, `HARD_MAX_FONT_SOURCES`, and `HARD_MAX_AGGREGATE_FONT_BYTES` constants are
re-exported by this package; currently they cap one face at 64 MiB, one composition at 256 sources
and 128 MiB, and all active document-specific export leases in a process at 128 MiB. A malformed or
individually over-limit origin is reported and skipped before later origins are consulted. A
process-wide lease refusal is a typed `layoutFailed` error: it does not start another network
fallback or silently substitute approximate pagination. Serverless and worker hosts should return
only the document-requested faces from resolvers, cap concurrent font-heavy exports, dispose every
reusable session promptly, and use the exported constants rather than duplicating numeric limits.

Document-embedded fonts are not automatically admitted by the Node defaults yet. A DOCX that
depends on `w:embedRegular`, `w:embedBold`, `w:embedItalic`, or `w:embedBoldItalic` is affected.
Those documents can paginate differently from the browser editor, which auto-wires those faces.
Logical full-document Markdown remains independent of page breaks.

Markdown is a semantic degradation:

- Physical Word-layout pages are first-class; flattened `markdown` is secondary.
- Page headers and footers are returned separately per page.
- Comments and tracked changes are normalized by core and exposed globally and per physical page.
- Review bindings map Core source provenance to exact Markdown offsets without changing Markdown.
- Merged table cells are flattened.
- GFM has no nested-table construct. Nested tables alone use inline, standards-valid HTML spans
  with `docx-nested-table`, `docx-nested-table__row`, and `docx-nested-table__cell` classes; inline
  Markdown remains parseable and review offsets remain mapped. Renderers that sanitize raw HTML
  must explicitly allow only those exporter-owned span classes and table/row/cell ARIA roles.
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
