// The Export menu of the demo top bar: a DOCX document saved in the browser, and PDF or Markdown
// through the converters in `menu-exporters.ts`. The React and Vue examples render the same
// rows and run the same export.
import { runChromeExport, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { demoExporters } from './menu-exporters';
import type { ExampleTextKey } from './example-text';

export type DemoExportFormat = 'docx' | 'pdf' | 'markdown';

export interface DemoExportRow {
  readonly format: DemoExportFormat;
  /** The text of the file type badge. */
  readonly badge: string;
  readonly tone: 'docx' | 'pdf' | 'md';
  readonly label: ExampleTextKey;
  readonly hint: ExampleTextKey;
}

export const DEMO_EXPORT_ROWS: readonly DemoExportRow[] = [
  {
    format: 'docx',
    badge: 'DOC',
    tone: 'docx',
    label: 'demoExport.docx',
    hint: 'demoExport.docxHint',
  },
  { format: 'pdf', badge: 'PDF', tone: 'pdf', label: 'demoExport.pdf', hint: 'demoExport.pdfHint' },
  {
    format: 'markdown',
    badge: 'MD',
    tone: 'md',
    label: 'demoExport.markdown',
    hint: 'demoExport.markdownHint',
  },
];

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Hand bytes to the browser as a download. */
export function downloadBytes(bytes: ArrayBuffer | Uint8Array, type: string, name: string): void {
  // `BlobPart`, not `ArrayBuffer`: a `Uint8Array` view hands over only its own bytes.
  const blob = new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Export the document in one format and download it, named after the title. */
export async function runDemoExport(
  editor: DocxEditorInstance,
  format: DemoExportFormat,
  title: string
): Promise<void> {
  const base = title.trim() || 'document';
  if (format === 'docx') {
    downloadBytes(await editor.save(), DOCX_TYPE, `${base}.docx`);
    return;
  }
  const result = await runChromeExport(editor, format, demoExporters);
  downloadBytes(result.bytes.slice(), result.mimeType, `${base}.${result.extension}`);
}

/**
 * The menu item that a key moves the focus to, or null for another key. Down and Up wrap; Home
 * and End go to the ends.
 */
export function nextDemoMenuItem(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowDown') return index < 0 ? 0 : (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  return null;
}
