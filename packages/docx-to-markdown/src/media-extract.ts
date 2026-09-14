import {
  ExportResourceError,
  type ExportSemanticLayout,
  type ExportSession,
} from '@docx-editor.dev/core/export';
import { forEachSemanticDrawing } from '@docx-editor.dev/core/layout';
import type {
  MarkdownImageAsset,
  MarkdownImageData,
  MarkdownImageOccurrence,
  MarkdownImageOptions,
  MarkdownProjectionOptions,
} from './media-types.ts';
import { MarkdownMediaError } from './media-errors.ts';

export const EMPTY_MEDIA: readonly MarkdownImageAsset[] = Object.freeze([]);
const EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
});

export function checkExportAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new ExportResourceError('aborted', 'Markdown export was aborted', {
      cause: signal.reason,
    });
}

export function imageOptions(options: MarkdownProjectionOptions): MarkdownImageOptions | undefined {
  const images = options.images;
  if (images === undefined || images === false) return undefined;
  if (images !== true && (typeof images !== 'object' || images === null || Array.isArray(images))) {
    throw new TypeError('images must be a boolean or an image options object');
  }
  const value = images === true ? {} : images;
  if (value.resolveUrl !== undefined && typeof value.resolveUrl !== 'function')
    throw new TypeError('images.resolveUrl must be a function');
  if (value.syntax !== undefined && value.syntax !== 'markdown' && value.syntax !== 'html')
    throw new TypeError('images.syntax must be "markdown" or "html"');
  const limit = value.maxTotalBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit <= 0)
    throw new TypeError('images.maxTotalBytes must be a positive safe integer');
  return value;
}

/** Copy once per unique content ID while the session still owns its byte capabilities. */
export function extractMedia(
  layout: ExportSemanticLayout,
  session: ExportSession,
  options?: MarkdownImageOptions
): readonly MarkdownImageData[] {
  if (!options) return EMPTY_MEDIA;
  const limit = options.maxTotalBytes ?? 64 * 1024 * 1024;
  const assets = new Map<
    string,
    { data: Omit<MarkdownImageData, 'occurrences'>; occurrences: MarkdownImageOccurrence[] }
  >();
  let total = 0;
  forEachSemanticDrawing(layout, ({ drawing, page, story, rootStory }) => {
    const resource = drawing.resource;
    if (resource.kind !== 'ready' || drawing.accessibility.hidden) return;
    // Core prefixes the digest with sha256:. Use its hex digest as a portable ID.
    const id = resource.contentId.startsWith('sha256:')
      ? resource.contentId.slice(7)
      : resource.contentId;
    let asset = assets.get(id);
    if (asset) {
      if (
        asset.data.mimeType !== resource.mime ||
        asset.data.pixelWidth !== resource.pixelWidth ||
        asset.data.pixelHeight !== resource.pixelHeight
      ) {
        throw new TypeError(`Conflicting image metadata for content ID ${id}`);
      }
    } else {
      const extension = EXTENSIONS[resource.mime];
      if (!extension || !/^[a-f0-9]{64}$/i.test(id))
        throw new TypeError('Invalid ready-image content identifier or MIME type');
      const bytes = session.validatedImageBytes(drawing);
      if (!bytes)
        throw new MarkdownMediaError(
          'image-bytes-unavailable',
          `Image bytes for ${id} are unavailable; keep the owning session open during extraction.`,
          { assetId: id }
        );
      total += bytes.byteLength;
      if (total > limit)
        throw new MarkdownMediaError(
          'media-limit',
          `Extracted images exceed images.maxTotalBytes (${total} > ${limit} bytes). Increase images.maxTotalBytes or use images: false.`,
          { assetId: id, limitBytes: limit, actualBytes: total }
        );
      asset = {
        data: {
          id,
          path: `media/${id}.${extension}`,
          mimeType: resource.mime,
          bytes,
          byteLength: bytes.byteLength,
          pixelWidth: resource.pixelWidth,
          pixelHeight: resource.pixelHeight,
        },
        occurrences: [],
      };
      assets.set(id, asset);
    }
    asset.occurrences.push(
      Object.freeze({
        pageNumber: page.index + 1,
        story,
        rootStory,
        partName: drawing.ownerPartName,
        drawingNodeId: drawing.drawingNodeId,
        paragraphId: drawing.paragraphId,
        start: drawing.start,
        displayWidthPx: drawing.width * (96 / 72),
        displayHeightPx: drawing.height * (96 / 72),
        kind: drawing.kind === 'inlineDrawing' ? 'inline' : 'anchored',
        decorative: drawing.accessibility.decorative,
        alt: drawing.accessibility.decorative ? '' : (drawing.accessibility.label ?? ''),
      })
    );
  });
  return Object.freeze(
    Array.from(assets.values(), ({ data, occurrences }) =>
      Object.freeze({ ...data, occurrences: Object.freeze(occurrences) })
    )
  );
}

export function validateImageUrl(url: unknown, assetId: string): asserts url is string {
  let valid =
    typeof url === 'string' &&
    url.trim().length > 0 &&
    !/[\u0000-\u001f\u007f\\]/.test(url) &&
    !url.startsWith('//') &&
    url === url.trim();
  if (valid && typeof url === 'string') {
    const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url);
    if (scheme) {
      try {
        const parsed = new URL(url);
        valid = /^https?:\/\//i.test(url) && Boolean(parsed.hostname);
      } catch {
        valid = false;
      }
    }
  }
  if (!valid)
    throw new MarkdownMediaError(
      'invalid-image-url',
      `Image ${assetId} needs a relative path or an absolute HTTP(S) URL.`,
      { assetId }
    );
}

export async function withExportAbort<T>(
  start: () => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  checkExportAbort(signal);
  let abort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () =>
      reject(
        new ExportResourceError('aborted', 'Markdown export was aborted', { cause: signal?.reason })
      );
    signal?.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        checkExportAbort(signal);
        return start();
      }),
      cancelled,
    ]);
  } finally {
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

export async function resolveMedia(
  data: readonly MarkdownImageData[],
  options: MarkdownProjectionOptions
): Promise<readonly MarkdownImageAsset[]> {
  const resolver = imageOptions(options)?.resolveUrl;
  const result: MarkdownImageAsset[] = [];
  for (const image of data) {
    checkExportAbort(options.signal);
    let url = image.path;
    if (resolver) {
      try {
        url = await withExportAbort(
          () =>
            Promise.resolve(
              resolver(Object.freeze({ ...image, bytes: image.bytes.slice() }), {
                signal: options.signal,
              })
            ),
          options.signal
        );
      } catch (cause) {
        checkExportAbort(options.signal);
        throw new MarkdownMediaError(
          'url-resolution-failed',
          `Could not resolve the URL for image ${image.id}. Completed uploads remain application-owned.`,
          { assetId: image.id, cause }
        );
      }
    }
    validateImageUrl(url, image.id);
    result.push(Object.freeze({ ...image, url }));
  }
  checkExportAbort(options.signal);
  return Object.freeze(result);
}
