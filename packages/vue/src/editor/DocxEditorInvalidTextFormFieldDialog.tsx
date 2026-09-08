import { defineComponent, ref, watch, type CSSProperties, type PropType } from 'vue';
import type { InvalidTextFormFieldSession } from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../docx-editor-children';
import { NativeDialog } from './dialog-parts';
import { useFormControlTranslate } from './form-control-translate';
/** Invalid-value acknowledgement with editor-owned clearing and focus restoration. @public */
export interface DocxEditorInvalidTextFormFieldDialogProps {
  session: InvalidTextFormFieldSession;
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
}
/** Default acknowledgement shell for a custom popup renderer. @public */
export const DocxEditorInvalidTextFormFieldDialog = defineComponent({
  name: 'DocxEditorInvalidTextFormFieldDialog',
  props: {
    session: { type: Object as PropType<InvalidTextFormFieldSession>, required: true },
    className: String,
    style: Object as PropType<CSSProperties>,
    children: Object as PropType<DocxEditorChildren>,
  },
  setup(props, { slots }) {
    const t = useFormControlTranslate();
    const closed = ref(false);
    watch(
      () => props.session,
      (session, _old, onCleanup) => {
        closed.value = session.signal.aborted;
        const abort = () => {
          closed.value = true;
        };
        session.signal.addEventListener('abort', abort, { once: true });
        onCleanup(() => session.signal.removeEventListener('abort', abort));
      },
      { immediate: true }
    );
    return () =>
      closed.value ? null : (
        <NativeDialog
          kind="invalidTextFormField"
          label={t('textFormField.invalidTitle')}
          role="alertdialog"
          class={props.className}
          style={props.style}
          onClose={() => props.session.acknowledge()}
          sessionSignal={props.session.signal}
          restoreFocus={false}
          dismissOutside={false}
          onKeydown={(event) => {
            if (event.key === 'Enter' && !event.isComposing) {
              event.preventDefault();
              props.session.acknowledge();
            }
          }}
          content={() =>
            slots.default?.() ??
            props.children ?? (
              <>
                <header class="docx-dialog__header">
                  <h2 class="docx-dialog__title">{t('textFormField.invalidTitle')}</h2>
                </header>
                <div class="docx-dialog__body">
                  {t(
                    props.session.type === 'number'
                      ? 'textFormField.invalidNumber'
                      : 'textFormField.invalidDate'
                  )}
                </div>
                <footer class="docx-dialog__footer">
                  <button
                    class="docx-dialog__button docx-dialog__button--primary"
                    type="button"
                    onClick={() => props.session.acknowledge()}
                  >
                    {t('textFormField.apply')}
                  </button>
                </footer>
              </>
            )
          }
        />
      );
  },
});
