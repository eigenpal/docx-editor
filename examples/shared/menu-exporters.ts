import type { ChromeExportHandlers } from '@docx-editor.dev/core/editor';
import { createT, en } from '@docx-editor.dev/i18n';

const t = createT(en, 'en');

/** Browser Markdown conversion and an explicit, user-triggered PDF server request. */
export const demoExporters: ChromeExportHandlers = {
  async markdown(source) {
    const { exportMarkdown } = await import('@docx-editor.dev/docx-to-markdown');
    return exportMarkdown(source, { displayMode: 'proposed' });
  },
  async pdf(source) {
    const response = await fetch('/api/convert?displayMode=proposed&fidelityPolicy=strict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      },
      body: source.slice().buffer,
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error(t('toolbar.exportPdfServerUnavailable'));
    }
    const result = (await response.json()) as { pdf?: string; message?: string };
    if (!response.ok || !result.pdf) {
      throw new Error(result.message ?? t('toolbar.exportPdfServerUnavailable'));
    }
    const binary = atob(result.pdf);
    return { bytes: Uint8Array.from(binary, (character) => character.charCodeAt(0)) };
  },
};
