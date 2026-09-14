# Images in browsers, Node.js, and server responses

Enable image extraction with one option:

```ts
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const result = await exportMarkdown(docxBytes, { images: true });
console.log(result.markdown); // ![Description](media/<digest>.png)
console.log(result.media); // Unique bytes, paths, URLs, dimensions, and occurrences.
```

`images: true` and `images: {}` use portable relative URLs. Existing calls omit images and return `media: []`.

Each image contains `id`, `path`, `mimeType`, `bytes`, `byteLength`, `pixelWidth`, `pixelHeight`, `url`, and `occurrences`. The ID is the hexadecimal SHA-256 digest already computed by Core. Its `sha256:` prefix is removed for portable filenames; extraction does not hash bytes again. MIME types and extensions describe the exported bytes, including converted raster images.

Occurrences contain `pageNumber`, `story`, `rootStory`, `partName`, `drawingNodeId`, `paragraphId`, `start`, `displayWidthPx`, `displayHeightPx`, `kind`, `decorative`, and `alt`. Repeated headers and repeated uses of identical bytes share one asset, with separate occurrences and descriptions. Source offsets use UTF-16 code units. Occurrence/page identities describe this export snapshot; retain your document version for stored citations.

## Preserve displayed image sizes

An image file's `pixelWidth` and `pixelHeight` describe its intrinsic pixels. Word can display the same file at different sizes.
Use each occurrence's `displayWidthPx` and `displayHeightPx` for the document's displayed size, in CSS pixels at 96 pixels per inch.
These values retain fractional pixels. `kind` distinguishes inline and anchored drawings.

Standard Markdown image syntax has no width or height attributes. To carry each occurrence's size into your Markdown renderer, select HTML image syntax:

```ts
const result = await exportMarkdown(docxBytes, {
  images: { syntax: 'html' },
});
// <img src="media/<digest>.png" alt="Banner" width="300" height="80">
```

The converter escapes HTML attributes and rounds the display dimensions to whole CSS pixels. Extents smaller than half a pixel round to zero.
This option works with local folders, ZIP downloads, and `resolveUrl` for server storage.
The default `syntax: 'markdown'` keeps standard image links without dimensions.
Both options return full occurrence metadata.

Configure your renderer to parse HTML, sanitize it, and retain `img` attributes `src`, `alt`, `width`, and `height`.
For example, [`react-markdown`](https://github.com/remarkjs/react-markdown#appendix-a-html-in-markdown) supports `rehype-raw` followed by [`rehype-sanitize`](https://github.com/rehypejs/rehype-sanitize); the default sanitizer retains these attributes.
If your renderer disables HTML or removes size attributes, use the metadata in a custom preview.

For a custom React preview, pass the selected occurrence and its asset's trusted preview URL:

```tsx
import type { MarkdownImageOccurrence } from '@docx-editor.dev/docx-to-markdown';

function ImagePreview({
  imageUrl,
  occurrence,
}: {
  imageUrl: string;
  occurrence: MarkdownImageOccurrence;
}) {
  const { displayWidthPx: width, displayHeightPx: height, alt } = occurrence;
  return (
    <img
      src={imageUrl}
      alt={alt}
      width={Math.round(width)}
      height={Math.round(height)}
      style={{
        display: 'inline',
        width,
        maxWidth: '100%',
        height: width === 0 || height === 0 ? height : 'auto',
        ...(width > 0 && height > 0 ? { aspectRatio: `${width} / ${height}` } : {}),
      }}
    />
  );
}
```

The explicit aspect ratio preserves Word's displayed proportions when the image shrinks, even if they differ from its intrinsic proportions.
Use the same styles in a custom Markdown image component, with `width` and `height` from the generated HTML.
Resolve `src` through your known asset URLs, as shown in the browser example.

Do not use an asset's first occurrence to size every image with the same URL.
Occurrences describe physical layout and include repeated headers; their order is not a Markdown image index.
Use HTML syntax to attach the correct dimensions directly to each rendered image.
For a preview built from occurrence metadata, identify the occurrence by its page, story, part, and drawing node.

Displayed dimensions describe the drawing's extent before crop and rotation. They do not reproduce cropping, rotation, effects, alignment, or floating text wrapping.
Anchored images appear at their source paragraph positions in Markdown.

## Save a local folder

```ts
import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';
import { writeMarkdownBundle } from '@docx-editor.dev/docx-to-markdown/node';

const result = await exportMarkdown(await readFile('input.docx'), { images: true });
await writeMarkdownBundle(result, { directory: './output' });
```

The helper writes `document.md`, `document.json`, and `media/`. The parent directory must exist. The output directory can be new or empty; existing files are never overwritten. Files use private permissions (`0o600`, subject to platform support). The JSON file includes full page/review metadata and image metadata, without binary bytes.

## Convert and download in the browser

Use the same public package with your bundler's font and WASM asset handling. The existing [runtime configuration](integrations.md) still applies; extraction does not require a server or a storage service.

```ts
import { exportMarkdown, createMarkdownZip } from '@docx-editor.dev/docx-to-markdown';

async function download(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await exportMarkdown(bytes, { images: true });
  const zip = await createMarkdownZip(result);
  const url = URL.createObjectURL(new Blob([zip.slice().buffer], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name.replace(/\.docx$/i, '') + '.zip';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
```

ZIP and folder output contain the same files. ZIP entry ordering and timestamps are deterministic. ZIP compression yields between bounded chunks; it needs no workers or worker CSP permissions. Both helpers require portable URLs (`image.url === image.path`). For a local bundle, export with `images: true` without `resolveUrl`; hosted-URL results produce `MarkdownBundleError` with `non-portable-image-url`.

For an on-screen preview, map paths to object URLs without rewriting Markdown:

```ts
const imageUrls = new Map(
  result.media.map((image) => [
    image.path,
    URL.createObjectURL(new Blob([image.bytes.slice().buffer], { type: image.mimeType })),
  ])
);

// Give your Markdown renderer a custom image component that looks up only known paths.
// Continue sanitizing Markdown and HTML. Render SVG through <img>, never inline SVG.
// On result replacement, unmount, or a discarded async result:
for (const url of imageUrls.values()) URL.revokeObjectURL(url);
```

Create URLs outside rendering. Keep them alive while the corresponding preview remains visible. Do not persist or transmit object URLs; they belong to the current browser context. See [MDN object URL lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static).

## Return server URLs to a client

The application supplies storage and returns its image URLs. The converter does not create a backend or upload files automatically.

```ts
import { exportMarkdown, toMarkdownJSON } from '@docx-editor.dev/docx-to-markdown';

// storage and documentId belong to your application.
const result = await exportMarkdown(docxBytes, {
  signal: request.signal,
  images: {
    resolveUrl: (image, { signal }) =>
      storage.upload(`documents/${documentId}/${image.path}`, image.bytes, {
        contentType: image.mimeType,
        signal,
      }),
  },
});
return Response.json(toMarkdownJSON(result));
```

`toMarkdownJSON` omits image bytes and converts arbitrary font-origin failure causes to diagnostic strings. It preserves the remaining export fields. Send binary image responses separately. Do not JSON-serialize `Uint8Array` values directly. Metadata stores raw URLs; Markdown destinations are escaped separately. Resolvers may return relative paths or absolute HTTP(S) URLs. Relative paths require application routing or accompanying files.

The resolver runs once per unique image, sequentially, after all extraction and budget checks succeed. This makes callback ordering predictable; many remote uploads incur cumulative latency. There are no automatic retries. URLs are finalized before translation, preserving correct review offsets. Applications own completed uploads, cleanup after failure, access control, and signed-URL expiry.

Serve untrusted media from an isolated origin without application cookies, or through a controlled response route. Set the actual `Content-Type` and `X-Content-Type-Options: nosniff`. For SVG, use a restrictive response CSP such as `sandbox; default-src 'none'`. Core's image validation is not SVG sanitization. Direct navigation to SVG has different restrictions from SVG displayed in `<img>`; never inline extracted SVG in trusted application markup. See [MDN SVG image restrictions](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image).

## Sessions, limits, and failure handling

```ts
const result = await exportMarkdownFrom(session, {
  images: { maxTotalBytes: 128 * 1024 * 1024 },
  signal,
});
```

`exportMarkdownFrom` leaves the caller's session open. Returned bytes survive disposal. `exportMarkdownLayout` remains synchronous and text-only because detached layouts do not own image bytes.

The default limit is **64 MiB of unique extracted bytes**, including assets from omitted text-box stories. It is not a total parsing, layout, or transient-memory limit. `maxTotalBytes` must be a positive safe integer. A limit failure rejects the export before any resolver runs. It does not return partial Markdown. Raise the limit or use `images: false`.

`MarkdownMediaError.code` is `media-limit`, `url-resolution-failed`, `invalid-image-url`, or `image-bytes-unavailable`. Limit errors include `limitBytes` and `actualBytes`, the total observed when the limit was exceeded. Resolver failures retain `cause` and the asset ID. Cancellation uses the existing `ExportResourceError` with code `aborted`; a resolver receives the signal and pending callback waits end promptly. Cancellation cannot interrupt synchronous parsing/layout or undo completed uploads.

The resolver gets a separate byte copy. Mutations cannot corrupt returned assets. Result byte arrays are caller-owned; treat them as read-only to preserve their IDs. Metadata objects and collections are frozen.

`MarkdownBundleError.code` is `invalid-media-path`, `duplicate-output-path`, `non-portable-image-url`, `output-not-empty`, `write-failed`, or `archive-failed`. Filesystem failures preserve the cause and relevant path. Helpers remove only files they created during a failed write.

## Output limits

Extraction covers validated ready images published by layout, including body, furniture, tables, notes, separators, and nested text boxes. Hidden and revision-suppressed images are not published and are not extracted. Unsupported images, missing resources, external links, and shapes remain omitted with warnings; extraction never fetches document-linked external images. Existing conversion hooks can supply raster replacements for preserved TIFF, EMF, and WMF files.

Inline and anchored images appear at their source paragraph positions, including table cells. Anchors within projected field results follow the field; display text cannot provide an exact source position. Decorative images have empty alternative text. Text-box content and note separators remain outside Markdown, although their image bytes and occurrences remain available. Unplaced anchors use an explicit `image-placement-fallback` warning. The logical document and affected page emit separate fallback warnings; page warnings include `pageNumber`. Cropping, rotation, and drawing effects are not reproduced. This is not a raw archive extractor.
