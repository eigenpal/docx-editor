import type { CSSProperties } from 'react';
import type { DocxEditorChildren } from '../docx-editor-children';
import type { ChromeExportFormat } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../i18n';
import { DialogFrame } from './dialog-parts';

/** State and presentation for the File menu export dialog. @public */
export interface DocxEditorExportDialogProps {
  /** Controls visibility when rendering the dialog directly. */
  open: boolean;
  /** The format selected in File > Export. */
  format: ChromeExportFormat;
  /** True while conversion runs. Closing the dialog does not cancel conversion. */
  pending: boolean;
  /** Localized failure text, or an empty string while conversion runs. */
  error: string;
  /** Dismisses feedback without canceling the export. */
  onClose(): void;
  /** Additional class on the dialog element. */
  className?: string;
  /** Inline styles on the dialog element. */
  style?: CSSProperties;
  /** Replaces the default contents while retaining the modal and focus behavior. */
  children?: DocxEditorChildren;
}

/** Default progress and error dialog for `popups.export`. @public */
export function DocxEditorExportDialog({
  open,
  format,
  pending,
  error,
  onClose,
  className,
  style,
  children,
}: DocxEditorExportDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;
  const title = error
    ? t(format === 'pdf' ? 'toolbar.exportPdfFailed' : 'toolbar.exportMarkdownFailed')
    : t(format === 'pdf' ? 'toolbar.exportingPdf' : 'toolbar.exportingMarkdown');
  return (
    <DialogFrame
      kind="export"
      label={title}
      role={error ? 'alertdialog' : 'dialog'}
      className={`docx-export-dialog${className ? ` ${className}` : ''}`}
      style={style}
      dismissOutside={false}
      onClose={onClose}
    >
      {children ?? (
        <>
          <header className="docx-dialog__header">
            <h2 className="docx-dialog__title docx-export-dialog__title">
              {pending && <span className="docx-export-dialog__spinner" aria-hidden="true" />}
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
        </>
      )}
    </DialogFrame>
  );
}
