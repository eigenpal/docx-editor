import { ref, type Ref } from 'vue';
import {
  ChromeExportError,
  runChromeExport,
  type ChromeExportFormat,
  type ChromeExportHandlers,
} from '@docx-editor.dev/core/editor';
import type { Editor } from '@docx-editor.dev/core';
import { useTranslation } from '../../i18n';
import { download, downloadName } from './download';

interface UseMenuExportReturn {
  readonly pending: Ref<boolean>;
  readonly error: Ref<string>;
  readonly execute: (format: ChromeExportFormat) => Promise<void>;
}

export function useMenuExport(
  editor: Ref<Editor | null>,
  exporters: () => ChromeExportHandlers | undefined,
  fileName: () => string | undefined
): UseMenuExportReturn {
  const { t } = useTranslation();
  const pending = ref(false);
  const error = ref('');
  const execute = async (format: ChromeExportFormat) => {
    if (!editor.value || pending.value) return;
    const name = fileName();
    pending.value = true;
    error.value = '';
    try {
      const result = await runChromeExport(editor.value, format, exporters());
      download(
        result.bytes.slice().buffer,
        downloadName(name).replace(/\.docx$/, `.${result.extension}`),
        result.mimeType
      );
    } catch (cause) {
      error.value =
        cause instanceof ChromeExportError
          ? t(
              cause.format === 'markdown'
                ? 'toolbar.exportMarkdownMissing'
                : 'toolbar.exportPdfMissing'
            )
          : t('toolbar.exportFailed', {
              message: cause instanceof Error ? cause.message : String(cause),
            });
    } finally {
      pending.value = false;
    }
  };
  return { pending, error, execute };
}
