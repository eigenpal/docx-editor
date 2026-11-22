import type { CSSProperties } from 'react';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useTranslation } from '../../i18n';
import { DialogFrame } from '../dialog-parts';

/**
 * Why a picture could not be inserted, or why a copy, cut, or paste was refused. Replace it
 * through `popups.imageInsertError`, or pass `false` there to show nothing.
 * @public
 */
export interface DocxEditorImageInsertErrorDialogProps {
  /** The translated reason the picture, or the copy, cut, or paste, was refused. */
  message: string;
  /** The translated title. Set for a refused copy, cut, or paste; the picture title otherwise. */
  title?: string;
  /** Close the dialog. */
  onClose(): void;
  className?: string;
  style?: CSSProperties;
  /** Replaces the packaged header, message and button. */
  children?: DocxEditorChildren;
}

/**
 * The packaged picture and clipboard refusal: an editor dialog, never a page-blocking browser
 * alert. @public
 */
export function DocxEditorImageInsertErrorDialog({
  message,
  title,
  onClose,
  className,
  style,
  children,
}: DocxEditorImageInsertErrorDialogProps) {
  const { t } = useTranslation();
  const heading = title ?? t('imageInsert.errors.title');
  return (
    <DialogFrame
      kind="imageInsertError"
      role="alertdialog"
      label={heading}
      className={className}
      style={style}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      {children ?? (
        <>
          <header className="docx-dialog__header">
            <h2 className="docx-dialog__title">{heading}</h2>
          </header>
          <div className="docx-dialog__body" data-docx-part="message">
            {message}
          </div>
          <footer className="docx-dialog__footer">
            <button
              type="button"
              className="docx-dialog__button docx-dialog__button--primary"
              onClick={onClose}
            >
              {t('common.close')}
            </button>
          </footer>
        </>
      )}
    </DialogFrame>
  );
}
