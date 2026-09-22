import type { Editor } from '../contracts/editor.ts';

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

/** File menu conversion formats. @public */
export type ChromeExportFormat = 'markdown' | 'pdf';

/**
 * Conversion handlers for File > Export. Install the corresponding converter package.
 * Use `exportMarkdown` for Markdown. PDF requires `exportPdf` on a Node.js server.
 * Browser hosts supply a PDF handler that calls that server after the user selects Export.
 * @public
 */
export interface ChromeExportHandlers {
  /** Returns continuous document Markdown. Page output is not downloaded. */
  readonly markdown?: (source: Uint8Array) => Promise<{ readonly markdown: string }>;
  /** Returns PDF bytes from `@docx-editor.dev/docx-to-pdf` on Node.js. */
  readonly pdf?: (source: Uint8Array) => Promise<{ readonly bytes: Uint8Array }>;
}

/** Download data from a completed conversion. @public */
export interface ChromeExportResult {
  readonly bytes: Uint8Array;
  readonly extension: 'md' | 'pdf';
  readonly mimeType: string;
}

/** An export has no configured converter. @public */
export class ChromeExportError extends Error {
  readonly code = 'missing-exporter';
  constructor(readonly format: ChromeExportFormat) {
    super(
      `Install @docx-editor.dev/docx-to-${format} and configure menu.exporters.${format}.` +
        (format === 'pdf' ? ' PDF conversion requires a Node.js server.' : '')
    );
    this.name = 'ChromeExportError';
  }
}

/**
 * Saves the current document and converts those bytes through the configured handler.
 * Missing handlers fail before saving. Conversion never changes the editor document.
 * @public
 */
export async function runChromeExport(
  editor: Pick<Editor, 'save'>,
  format: ChromeExportFormat,
  handlers: ChromeExportHandlers = {}
): Promise<ChromeExportResult> {
  if (format === 'markdown') {
    if (!handlers.markdown) throw new ChromeExportError(format);
    const result = await handlers.markdown(new Uint8Array(await editor.save()));
    if (typeof result?.markdown !== 'string')
      throw new TypeError('The Markdown converter returned no Markdown.');
    return {
      bytes: new TextEncoder().encode(result.markdown),
      extension: 'md',
      mimeType: 'text/markdown;charset=utf-8',
    };
  }
  if (format !== 'pdf') throw new TypeError('Unsupported export format.');
  if (!handlers.pdf) throw new ChromeExportError(format);
  const result = await handlers.pdf(new Uint8Array(await editor.save()));
  if (!(result?.bytes instanceof Uint8Array) || result.bytes.length === 0) {
    throw new TypeError('The PDF converter returned no PDF bytes.');
  }
  if (!PDF_HEADER.every((byte, index) => result.bytes[index] === byte)) {
    throw new TypeError('The PDF converter returned a file without a PDF header.');
  }
  return { bytes: result.bytes, extension: 'pdf', mimeType: 'application/pdf' };
}
