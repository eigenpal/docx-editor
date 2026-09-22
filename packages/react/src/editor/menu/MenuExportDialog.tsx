import type { ChromeExportFormat } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../../i18n';
import { DialogFrame } from '../dialog-parts';

/** Export progress stays outside the menu's layout and keyboard navigation. */
export function MenuExportDialog({
  format,
  error,
  onClose,
}: {
  format: ChromeExportFormat;
  error: string;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const title = error
    ? t(format === 'pdf' ? 'toolbar.exportPdfFailed' : 'toolbar.exportMarkdownFailed')
    : t(format === 'pdf' ? 'toolbar.exportingPdf' : 'toolbar.exportingMarkdown');
  return (
    <DialogFrame
      kind="export"
      label={title}
      role={error ? 'alertdialog' : 'dialog'}
      className="docx-export-dialog"
      dismissOutside={false}
      onClose={onClose}
    >
      <header className="docx-dialog__header">
        <h2 className="docx-dialog__title docx-export-dialog__title">
          {!error && <span className="docx-export-dialog__spinner" aria-hidden="true" />}
          {title}
        </h2>
      </header>
      <div className="docx-dialog__body">
        <p className="docx-export-dialog__message" role={error ? 'alert' : 'status'}>
          {error || t('toolbar.exportDownloadHint')}
        </p>
      </div>
      <footer className="docx-dialog__footer">
        <button type="button" className="docx-dialog__button" onClick={onClose}>
          {t(error ? 'common.close' : 'toolbar.exportContinueEditing')}
        </button>
      </footer>
    </DialogFrame>
  );
}
