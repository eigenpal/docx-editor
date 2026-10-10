import type { DocxEditorChildren } from '../docx-editor-children';
import { defineComponent, type CSSProperties, type PropType } from 'vue';
import type { ChromeExportFormat } from '@docx-editor.dev/core/editor';
import { useTranslation } from '../i18n';
import { NativeDialog } from './dialog-parts';

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
export const DocxEditorExportDialog = defineComponent({
  name: 'DocxEditorExportDialog',
  inheritAttrs: false,
  props: {
    open: { type: Boolean, required: true },
    pending: { type: Boolean, required: true },
    className: String,
    style: Object as PropType<CSSProperties>,
    children: Object as PropType<DocxEditorChildren>,
    format: { type: String as PropType<ChromeExportFormat>, required: true },
    error: { type: String, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
  },
  setup(props, { attrs, slots }) {
    const { t } = useTranslation();
    return () => {
      if (!props.open) return null;
      const title = props.error
        ? t(props.format === 'pdf' ? 'toolbar.exportPdfFailed' : 'toolbar.exportMarkdownFailed')
        : t(props.format === 'pdf' ? 'toolbar.exportingPdf' : 'toolbar.exportingMarkdown');
      return (
        <NativeDialog
          kind="export"
          label={title}
          role={props.error ? 'alertdialog' : 'dialog'}
          class={[
            'docx-export-dialog',
            props.pending && 'docx-export-dialog--pending',
            props.className,
            attrs.class,
          ]}
          style={props.style}
          dismissOutside={false}
          onClose={props.onClose}
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
            )
          }
        />
      );
    };
  },
});
