import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import type { MarkdownExportResult } from './markdown-types.ts';
import type { MarkdownImageAsset } from './media-types.ts';
import { MarkdownBundleError } from './media-errors.ts';

/** JSON-safe image metadata. Binary bytes are delivered separately. @public */
export type MarkdownJSONImage = Omit<MarkdownImageAsset, 'bytes'>;
/** JSON-safe export for HTTP responses and portable bundle manifests. @public */
export type MarkdownJSONResult = Omit<MarkdownExportResult, 'media' | 'fontResolution'> & {
  readonly media: readonly MarkdownJSONImage[];
  readonly fontResolution:
    | (Omit<NonNullable<MarkdownExportResult['fontResolution']>, 'originFailures'> & {
        readonly originFailures: readonly {
          readonly originIndex: number;
          readonly originName?: string;
          readonly cause: string;
        }[];
      })
    | null;
};

function diagnosticText(cause: unknown): string {
  try {
    return String(cause);
  } catch {
    return 'Font origin failed (cause could not be converted to text).';
  }
}

/** Omit image bytes and normalize arbitrary font failure causes to diagnostic strings. @public */
export function toMarkdownJSON(result: MarkdownExportResult): MarkdownJSONResult {
  return Object.freeze({
    ...result,
    media: Object.freeze(result.media.map(({ bytes: _bytes, ...image }) => Object.freeze(image))),
    fontResolution: result.fontResolution
      ? Object.freeze({
          ...result.fontResolution,
          originFailures: Object.freeze(
            result.fontResolution.originFailures.map((failure) =>
              Object.freeze({
                ...failure,
                cause: diagnosticText(failure.cause),
              })
            )
          ),
        })
      : null,
  });
}

/** Preflight the complete file set before either writer has side effects. */
export function markdownBundleFiles(result: MarkdownExportResult): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  files.set('document.md', strToU8(result.markdown));
  files.set('document.json', strToU8(JSON.stringify(toMarkdownJSON(result), null, 2)));
  for (const image of result.media) {
    if (!/^media\/[a-f0-9]{64}\.(?:png|jpg|gif|bmp|webp|svg)$/i.test(image.path)) {
      throw new MarkdownBundleError(
        'invalid-media-path',
        'Image paths must be generated media/<content-id>.<extension> filenames.',
        { path: image.path }
      );
    }
    if (files.has(image.path))
      throw new MarkdownBundleError(
        'duplicate-output-path',
        'Two assets have the same output path.',
        { path: image.path }
      );
    if (image.url !== image.path)
      throw new MarkdownBundleError(
        'non-portable-image-url',
        'Portable bundles require images: true without resolveUrl. Export a separate portable result for local files.',
        { path: image.path }
      );
    files.set(image.path, image.bytes);
  }
  return files;
}

/** Create a portable ZIP containing document.md, document.json, and media files. @public */
export async function createMarkdownZip(result: MarkdownExportResult): Promise<Uint8Array> {
  const files = markdownBundleFiles(result);
  const chunks: Uint8Array[] = [];
  let length = 0;
  let failure: Error | null = null;
  let finished = false;
  const archive = new Zip((cause, chunk, final) => {
    if (cause) {
      failure = cause;
      return;
    }
    chunks.push(chunk);
    length += chunk.length;
    finished = final;
  });
  try {
    // fflate's one-shot async helper silently requires workers for larger files.
    // Stream bounded chunks instead, yielding to the host without worker or CSP setup.
    const chunkSize = 256 * 1024;
    let sinceYield = 0;
    for (const [path, bytes] of files) {
      const file = path.startsWith('media/')
        ? new ZipPassThrough(path)
        : new ZipDeflate(path, { level: 6 });
      // ZIP stores local DOS time. Fixed local components are stable across time zones.
      file.mtime = new Date(1980, 0, 1);
      archive.add(file);
      if (bytes.length === 0) file.push(bytes, true);
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        const chunk = bytes.subarray(offset, offset + chunkSize);
        file.push(chunk, offset + chunk.length === bytes.length);
        if (failure) throw failure;
        sinceYield += chunk.length;
        if (sinceYield >= chunkSize) {
          sinceYield = 0;
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      }
    }
    archive.end();
    if (failure) throw failure;
    if (!finished) throw new Error('ZIP output did not finish.');
    const output = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  } catch (cause) {
    archive.terminate();
    throw new MarkdownBundleError('archive-failed', 'Could not create the Markdown ZIP.', {
      cause,
    });
  }
}
