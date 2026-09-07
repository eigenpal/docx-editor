import type { MarkdownExportResult } from '@docx-editor.dev/docx-to-markdown';
import type { ExportStatus } from './export-state';

export type DeveloperPanelTab = 'example' | 'response';

export interface PreviewFields {
  readonly showHeaders: boolean;
  readonly showFooters: boolean;
  readonly showComments: boolean;
  readonly showTrackedChanges: boolean;
}

export const DEFAULT_PREVIEW_FIELDS: PreviewFields = {
  showHeaders: true,
  showFooters: true,
  showComments: true,
  showTrackedChanges: true,
};

export function quickstart(
  fields: PreviewFields = DEFAULT_PREVIEW_FIELDS,
  filename = 'document.docx'
): string {
  const selectedFields = [
    fields.showHeaders && '  console.log(page.headerMarkdown);',
    '  console.log(page.markdown);',
    fields.showFooters && '  console.log(page.footerMarkdown);',
    fields.showComments && '  console.log(page.comments);',
    fields.showTrackedChanges && '  console.log(page.trackedChanges);',
  ]
    .filter(Boolean)
    .join('\n');
  return `import { readFile } from 'node:fs/promises';
import { exportMarkdown } from '@docx-editor.dev/docx-to-markdown';
import { googleFonts } from '@docx-editor.dev/fonts/google';

const docxBytes = new Uint8Array(await readFile(${JSON.stringify(filename)}));
const result = await exportMarkdown(docxBytes, {
  fallbackFonts: googleFonts(),
});

console.log(result.markdown); // Full document body.

// Selected page fields. The API returns all fields.
for (const page of result.pages) {
${selectedFields}
}`;
}

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
  error: string | null = null,
  fields: PreviewFields = DEFAULT_PREVIEW_FIELDS,
  filename = 'document.docx'
): string {
  return tab === 'example' ? quickstart(fields, filename) : responsePreview(result, status, error);
}
