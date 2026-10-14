import { defineComponent, type CSSProperties, type PropType } from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { useTranslation } from '../../i18n';
import { NativeDialog } from '../dialog-parts';

/**
 * Why a picture could not be inserted. Replace it through `popups.imageInsertError`, or pass
 * `false` there to show nothing.
 * @public
 */
export interface DocxEditorImageInsertErrorDialogProps {
  /** The translated reason the picture was refused. */
  message: string;
  /** Close the dialog. */
  onClose(): void;
  className?: string;
  style?: CSSProperties;
  /** Replaces the packaged header, message and button. */
  children?: DocxEditorChildren;
}

/** The packaged picture refusal: an editor dialog, never a page-blocking browser alert. @public */
export const DocxEditorImageInsertErrorDialog = defineComponent({
  name: 'DocxEditorImageInsertErrorDialog',
  props: {
    message: { type: String, required: true },
    onClose: { type: Function as PropType<() => void>, required: true },
    className: String,
    style: Object as PropType<CSSProperties>,
    children: Object as PropType<DocxEditorChildren>,
  },
  setup(props, { slots }) {
    const { t } = useTranslation();
    return () => (
      <NativeDialog
        kind="imageInsertError"
        label={t('imageInsert.errors.title')}
        role="alertdialog"
        class={props.className}
        style={props.style}
        onClose={() => props.onClose()}
        onKeydown={(event: KeyboardEvent) => {
          if (event.key === 'Enter' && !event.isComposing) {
            event.preventDefault();
            props.onClose();
          }
        }}
        content={() =>
          slots.default?.() ??
          props.children ?? (
            <>
              <header class="docx-dialog__header">
                <h2 class="docx-dialog__title">{t('imageInsert.errors.title')}</h2>
              </header>
              <div class="docx-dialog__body" data-docx-part="message">
                {props.message}
              </div>
              <footer class="docx-dialog__footer">
                <button
                  type="button"
                  class="docx-dialog__button docx-dialog__button--primary"
                  onClick={() => props.onClose()}
                >
                  {t('common.close')}
                </button>
              </footer>
            </>
          )
        }
      />
    );
  },
});
