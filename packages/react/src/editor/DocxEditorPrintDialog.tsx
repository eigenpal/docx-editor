import type { CSSProperties } from 'react';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import { isChromePrintShortcut } from '@docx-editor.dev/core/editor';
import { DialogFrame } from './dialog-parts';

/** State and presentation for the File menu print dialog. @public */
export interface DocxEditorPrintDialogProps {
  /** Controls visibility when rendering the dialog directly. */
  open: boolean;
  /** True while the PDF handler converts the document. */
  pending: boolean;
  /** Localized failure text, or an empty string. */
  error: string;
  /**
   * An object URL for the converted PDF when printing failed after conversion, such as in a
   * browser without a PDF viewer. Otherwise an empty string. The default dialog links only
   * to `blob:` URLs.
   */
  url: string;
  /** Closes the dialog. While `pending` is true, closing also cancels printing. */
  onClose(): void;
  /** Additional class on the dialog element. */
  className?: string;
  /** Inline styles on the dialog element. */
  style?: CSSProperties;
  /** Replaces the default contents while retaining the modal and focus behavior. */
  children?: DocxEditorChildren;
}

/**
 * Default progress and error dialog for `popups.print`. The editor closes it when the
 * browser print dialog opens.
 * @public
 */
export function DocxEditorPrintDialog({
  open,
  pending,
  error,
  url,
  onClose,
  className,
  style,
  children,
}: DocxEditorPrintDialogProps) {
  const { t } = useTranslation();
  if (!open) return null;
  const title = t(error ? 'toolbar.printFailed' : 'toolbar.printPreparing');
  // Only the editor's own object URL becomes a link.
  const openUrl = url.startsWith('blob:') ? url : '';
  return (
    <DialogFrame
      kind="print"
      label={title}
      role={error ? 'alertdialog' : 'dialog'}
      className={`docx-export-dialog docx-print-dialog${pending ? ' docx-export-dialog--pending' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      dismissOutside={false}
      onClose={onClose}
      // The dialog stops key events, so it claims the print shortcut itself. Otherwise the
      // browser prints the editor page while the PDF is prepared.
      onKeyDown={(event) => {
        if (isChromePrintShortcut(event.nativeEvent)) event.preventDefault();
      }}
    >
      {children ?? (
        <>
          <header className="docx-dialog__header">
            {pending && (
              <div className="docx-export-dialog__progress" aria-hidden="true">
                <span className="docx-export-dialog__spinner" />
              </div>
            )}
            <h2 className="docx-dialog__title">{title}</h2>
          </header>
          {error && (
            <div className="docx-dialog__body">
              <p className="docx-export-dialog__message" role="alert">
                {error}
              </p>
            </div>
          )}
          <footer className="docx-dialog__footer">
            {error && openUrl && (
              <a
                className="docx-dialog__link-button docx-print-dialog__open"
                href={openUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('toolbar.printOpenPdf')}
              </a>
            )}
            <button type="button" className="docx-dialog__button" onClick={onClose}>
              {t(error ? 'common.close' : 'common.cancel')}
            </button>
          </footer>
        </>
      )}
    </DialogFrame>
  );
}
