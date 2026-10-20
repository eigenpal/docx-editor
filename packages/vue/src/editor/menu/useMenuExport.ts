import { ref, shallowRef, type Ref } from 'vue';
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
  readonly session: Ref<object>;
  readonly error: Ref<string>;
  readonly format: Ref<ChromeExportFormat>;
  readonly visible: Ref<boolean>;
  readonly dismiss: () => void;
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
  const format = ref<ChromeExportFormat>('pdf');
  const visible = ref(false);
  const session = shallowRef<object>({});
  const execute = async (requestedFormat: ChromeExportFormat) => {
    if (!editor.value || pending.value) return;
    const name = fileName();
    session.value = {};
    format.value = requestedFormat;
    visible.value = true;
    pending.value = true;
    error.value = '';
    try {
      const result = await runChromeExport(editor.value, requestedFormat, exporters());
      download(
        result.bytes.slice().buffer,
        downloadName(name).replace(/\.docx$/, `.${result.extension}`),
        result.mimeType
      );
      visible.value = false;
    } catch (cause) {
      visible.value = true;
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
  return {
    pending,
    error,
    format,
    visible,
    session,
    dismiss: () => {
      visible.value = false;
    },
    execute,
  };
}
