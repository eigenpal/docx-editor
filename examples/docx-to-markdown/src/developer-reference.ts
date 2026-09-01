import type { MarkdownExportResult } from '@docx-editor.dev/docx-to-markdown';
import type { ExportStatus } from './export-state';

export type DeveloperPanelTab = 'example' | 'response';

export const QUICKSTART = `import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';

const bytes = new Uint8Array(await readFile('document.docx'));
const result = await exportMarkdown(bytes);

console.log(result.markdown);       // complete logical document
console.log(result.pages[0]);       // page-aware Markdown + review artifacts
console.log(result.fontResolution); // font fidelity evidence`;

function responseJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, candidate: unknown) => {
      if (candidate instanceof Error) {
        return { name: candidate.name, message: candidate.message };
      }
      if (typeof candidate === 'bigint') return `${candidate}n`;
      return candidate;
    },
    2
  );
}

function responsePreview(
  result: MarkdownExportResult | null,
  status: ExportStatus,
  error: string | null
): string {
  if (status === 'error') {
    return `// The current DOCX export failed. No stale API response is shown.\n// ${error ?? 'Unknown export error'}`;
  }
  if (status === 'queued' || status === 'exporting') {
    return '// Updating the DOCX export… The live API response will appear when it is ready.';
  }
  if (!result) return '// The live API response appears here after the DOCX export completes.';
  try {
    return responseJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `// The live API response could not be formatted safely.\n// ${message}`;
  }
}

export function developerPanelContent(
  tab: DeveloperPanelTab,
  result: MarkdownExportResult | null,
  status: ExportStatus = result ? 'ready' : 'idle',
  error: string | null = null
): string {
  return tab === 'example' ? QUICKSTART : responsePreview(result, status, error);
}
