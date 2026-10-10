import type { DocxEditorChildren } from '../docx-editor-children';
import { defineComponent, type CSSProperties, type PropType } from 'vue';
import { useTranslation } from '../i18n';
import { isChromePrintShortcut } from '@docx-editor.dev/core/editor';
import { NativeDialog } from './dialog-parts';

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
export const DocxEditorPrintDialog = defineComponent({
  name: 'DocxEditorPrintDialog',
  inheritAttrs: false,
  props: {
    open: { type: Boolean, required: true },
    pending: { type: Boolean, required: true },
    className: String,
    style: Object as PropType<CSSProperties>,
    children: Object as PropType<DocxEditorChildren>,
    error: { type: String, required: true },
    url: { type: String, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
  },
  setup(props, { attrs, slots }) {
    const { t } = useTranslation();
    return () => {
      if (!props.open) return null;
      const title = t(props.error ? 'toolbar.printFailed' : 'toolbar.printPreparing');
      // Only the editor's own object URL becomes a link.
      const openUrl = props.url.startsWith('blob:') ? props.url : '';
      return (
        <NativeDialog
          kind="print"
          label={title}
          role={props.error ? 'alertdialog' : 'dialog'}
          class={[
            'docx-export-dialog',
            'docx-print-dialog',
            props.pending && 'docx-export-dialog--pending',
            props.className,
            attrs.class,
          ]}
          style={props.style}
          dismissOutside={false}
          onClose={props.onClose}
          // The dialog stops key events, so it claims the print shortcut itself. Otherwise
          // the browser prints the editor page while the PDF is prepared.
          onKeydown={(event: KeyboardEvent) => {
            if (isChromePrintShortcut(event)) event.preventDefault();
          }}
          content={() =>
            slots.default?.() ??
            props.children ?? (
              <>
                <header class="docx-dialog__header">
                  {props.pending && (
                    <div class="docx-export-dialog__progress" aria-hidden="true">
                      <span class="docx-export-dialog__spinner" />
                    </div>
                  )}
                  <h2 class="docx-dialog__title">{title}</h2>
                </header>
                {props.error && (
                  <div class="docx-dialog__body">
                    <p class="docx-export-dialog__message" role="alert">
                      {props.error}
                    </p>
                  </div>
                )}
                <footer class="docx-dialog__footer">
                  {props.error && openUrl && (
                    <a
                      class="docx-dialog__link-button docx-print-dialog__open"
                      href={openUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('toolbar.printOpenPdf')}
                    </a>
                  )}
                  <button type="button" class="docx-dialog__button" onClick={props.onClose}>
                    {t(props.error ? 'common.close' : 'common.cancel')}
                  </button>
                </footer>
              </>
            )
          }
        />
      );
    };
  },
});
