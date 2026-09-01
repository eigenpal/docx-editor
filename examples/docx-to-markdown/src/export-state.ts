export type ExportStatus = 'idle' | 'queued' | 'exporting' | 'ready' | 'error';

export function canCopyExport(status: ExportStatus, hasResult: boolean): boolean {
  return status === 'ready' && hasResult;
}
