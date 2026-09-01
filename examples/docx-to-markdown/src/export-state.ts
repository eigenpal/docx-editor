export type ExportStatus = 'idle' | 'queued' | 'exporting' | 'ready' | 'error';

export function canCopyExport(status: ExportStatus, hasResult: boolean): boolean {
  return status === 'ready' && hasResult;
}

/** Return only the durable copy projection; preview Blob URLs never enter the clipboard. */
export function copyableMarkdown(
  status: ExportStatus,
  portableMarkdown: string | null
): string | null {
  return canCopyExport(status, portableMarkdown !== null) ? portableMarkdown : null;
}
