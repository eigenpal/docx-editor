import type { ExportStatus } from './export-state';

export type PreviewMode = 'rendered' | 'source' | 'developer';

export function markdownPageToReveal(
  mode: PreviewMode,
  status: ExportStatus,
  hasResult: boolean,
  latestEditorPage: number
): number | null {
  return mode !== 'developer' && status === 'ready' && hasResult ? latestEditorPage : null;
}
