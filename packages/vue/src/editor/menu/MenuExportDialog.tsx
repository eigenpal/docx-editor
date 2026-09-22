import { defineComponent, type PropType } from 'vue';
import type { ChromeExportFormat } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { NativeDialog } from '../dialog-parts';

/** Export progress stays outside the menu's layout and keyboard navigation. */
export const MenuExportDialog = defineComponent({
  name: 'MenuExportDialog',
  props: {
    format: { type: String as PropType<ChromeExportFormat>, required: true },
    error: { type: String, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
  },
  setup(props) {
    const { t } = useTranslation();
    return () => {
      const title = props.error
        ? t(props.format === 'pdf' ? 'toolbar.exportPdfFailed' : 'toolbar.exportMarkdownFailed')
        : t(props.format === 'pdf' ? 'toolbar.exportingPdf' : 'toolbar.exportingMarkdown');
      return (
        <NativeDialog
          kind="export"
          label={title}
          role={props.error ? 'alertdialog' : 'dialog'}
          class="docx-export-dialog"
          dismissOutside={false}
          onClose={props.onClose}
          content={() => (
            <>
              <header class="docx-dialog__header">
                <h2 class="docx-dialog__title docx-export-dialog__title">
                  {!props.error && <span class="docx-export-dialog__spinner" aria-hidden="true" />}
                  {title}
                </h2>
              </header>
              <div class="docx-dialog__body">
                <p class="docx-export-dialog__message" role={props.error ? 'alert' : 'status'}>
                  {props.error || t('toolbar.exportDownloadHint')}
                </p>
              </div>
              <footer class="docx-dialog__footer">
                <button type="button" class="docx-dialog__button" onClick={props.onClose}>
                  {t(props.error ? 'common.close' : 'toolbar.exportContinueEditing')}
                </button>
              </footer>
            </>
          )}
        />
      );
    };
  },
});
