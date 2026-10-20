/** Failure to produce a complete image export. @public */
export class MarkdownMediaError extends Error {
  readonly name = 'MarkdownMediaError';
  constructor(
    readonly code:
      | 'media-limit'
      | 'url-resolution-failed'
      | 'invalid-image-url'
      | 'image-bytes-unavailable',
    message: string,
    details: {
      readonly assetId?: string;
      readonly limitBytes?: number;
      readonly actualBytes?: number;
      readonly cause?: unknown;
    } = {}
  ) {
    super(message, { cause: details.cause });
    this.assetId = details.assetId;
    this.limitBytes = details.limitBytes;
    this.actualBytes = details.actualBytes;
  }
  readonly assetId?: string;
  readonly limitBytes?: number;
  readonly actualBytes?: number;
}

/** Failure to write a complete portable Markdown bundle. @public */
export class MarkdownBundleError extends Error {
  readonly name = 'MarkdownBundleError';
  constructor(
    readonly code:
      | 'invalid-media-path'
      | 'duplicate-output-path'
      | 'non-portable-image-url'
      | 'output-not-empty'
      | 'write-failed'
      | 'archive-failed',
    message: string,
    details: { readonly path?: string; readonly cause?: unknown } = {}
  ) {
    super(message, { cause: details.cause });
    this.path = details.path;
  }
  readonly path?: string;
}
