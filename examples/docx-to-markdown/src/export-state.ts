export type ExportStatus = 'idle' | 'queued' | 'exporting' | 'ready' | 'error';

export function canCopyExport(status: ExportStatus, hasResult: boolean): boolean {
  return status === 'ready' && hasResult;
}

/** Return the last complete full-document Markdown projection. */
export function copyableMarkdown(status: ExportStatus, markdown: string | null): string | null {
  return canCopyExport(status, markdown !== null) ? markdown : null;
}
