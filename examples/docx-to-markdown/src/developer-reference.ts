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

const MAX_PREVIEW_PAGES = 3;
const MAX_PREVIEW_ARRAY_ITEMS = 16;
const MAX_PREVIEW_STRING_LENGTH = 8_000;

function boundedJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, candidate: unknown) => {
      if (candidate instanceof Error) {
        return { name: candidate.name, message: candidate.message };
      }
      if (typeof candidate === 'bigint') return `${candidate}n`;
      if (typeof candidate === 'string' && candidate.length > MAX_PREVIEW_STRING_LENGTH) {
        return `${candidate.slice(0, MAX_PREVIEW_STRING_LENGTH)}\n… ${candidate.length - MAX_PREVIEW_STRING_LENGTH} characters omitted`;
      }
      if (Array.isArray(candidate) && candidate.length > MAX_PREVIEW_ARRAY_ITEMS) {
        return [
          ...candidate.slice(0, MAX_PREVIEW_ARRAY_ITEMS),
          `… ${candidate.length - MAX_PREVIEW_ARRAY_ITEMS} items omitted`,
        ];
      }
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
    return boundedJson({
      $preview:
        'Live response, bounded for this browser panel. Application code receives the complete object.',
      pages: result.pages.slice(0, MAX_PREVIEW_PAGES),
      pagesOmitted: Math.max(0, result.pages.length - MAX_PREVIEW_PAGES),
      reviewArtifacts: result.reviewArtifacts,
      reviewBindings: result.reviewBindings,
      fontResolution: result.fontResolution,
      pagination: result.pagination,
      markdown: result.markdown,
    });
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
