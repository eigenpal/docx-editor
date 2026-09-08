import { useEditorState } from './useEditorState';
import {
  Fragment,
  computed,
  defineComponent,
  ref,
  watch,
  type CSSProperties,
  type PropType,
  type VNode,
} from 'vue';
import { TEXT_FORM_FORMATS, type TextFormFieldDialogSession } from '@docx-editor.dev/core/editor';
import type { TextFormFieldOptions, TextFormFieldType } from '@docx-editor.dev/core/store';
import { useFormControlTranslate } from './form-control-translate';
import {
  createDialogComposition,
  NativeDialog,
  type DialogCustomizationProps,
  type UseDialogReturn,
} from './dialog-parts';
/** Editable Field Options draft. @public */
export interface TextFormFieldDialogFields {
  defaultText: string;
  type: string;
  maxLength: number;
  format: string;
  enabled: boolean;
}
/** Field Options draft state and actions. @public */
export interface UseTextFormFieldDialogReturn extends UseDialogReturn<TextFormFieldDialogFields> {}
const composition = createDialogComposition<TextFormFieldDialogFields>('TextFormFieldDialog');
/** Access the Field Options draft and actions. @public */
export function useTextFormFieldDialog(): UseTextFormFieldDialogReturn {
  return composition.useContext();
}
/** Controlled Field Options dialog. @public */
export interface DocxEditorTextFormFieldDialogProps extends DialogCustomizationProps {
  session: TextFormFieldDialogSession | null;
}
const Impl = defineComponent({
  name: 'DocxEditorTextFormFieldDialog',
  props: {
    session: { type: Object as PropType<TextFormFieldDialogSession | null>, default: null },
    preset: { type: Boolean, default: true },
    className: String,
    style: Object as PropType<CSSProperties>,
  },
  setup(p, { slots }) {
    const t = useFormControlTranslate();
    const values = ref<TextFormFieldDialogFields>({
      defaultText: '',
      type: 'regular',
      maxLength: 0,
      format: '',
      enabled: true,
    });
    const refused = ref(false);
    const closed = ref(false);
    watch(
      () => p.session,
      (session, _old, onCleanup) => {
        refused.value = false;
        closed.value = false;
        if (!session) return;
        const { defaultText, type, maxLength, format, enabled } = session.field;
        values.value = { defaultText, type, maxLength, format, enabled };
        const abort = () => {
          closed.value = true;
        };
        session.signal.addEventListener('abort', abort, { once: true });
        onCleanup(() => session.signal.removeEventListener('abort', abort));
      },
      { immediate: true }
    );
    const isEnabled = useEditorState(() => p.session?.canApply() ?? false, Object.is, {
      extraDeps: () => p.session,
    });
    const cancel = () => p.session?.cancel();
    const apply = () => {
      if (!p.session?.canApply()) {
        refused.value = true;
        return;
      }
      const { defaultText, ...options } = values.value;
      refused.value = !p.session?.apply(defaultText, options as TextFormFieldOptions);
    };
    const renderParts = composition.provideContext({
      values,
      errors: computed(() => (refused.value ? { form: t('textFormField.invalidOptions') } : {})),
      isEnabled,
      setValue: (name, value) => {
        values.value = {
          ...values.value,
          [name]: value,
          ...(name === 'type' ? { format: '' } : {}),
        };
      },
      apply,
      cancel,
    });
    return () => {
      if (!p.session || p.session.signal.aborted || closed.value) return null;
      const v = values.value;
      const field = (name: keyof TextFormFieldDialogFields, input: VNode) => (
        <label data-docx-part="field" data-docx-field={name} class="docx-dialog__row">
          <span class="docx-dialog__label">{t(`textFormField.${name}`)}</span>
          {input}
        </label>
      );
      const regularLabels = {
        Uppercase: 'textFormField.uppercase',
        Lowercase: 'textFormField.lowercase',
        'First capital': 'textFormField.firstCapital',
        'Title case': 'textFormField.titleCase',
      } as const;
      const formatLabel = (format: string) => {
        const key = regularLabels[format as keyof typeof regularLabels];
        return key ? t(key) : format || t('textFormField.noFormat');
      };
      const formats: readonly string[] = TEXT_FORM_FORMATS[v.type as TextFormFieldType] ?? [];
      const defaults = (
        <Fragment>
          <div data-docx-part="header" class="docx-dialog__header">
            <span data-docx-part="title" class="docx-dialog__title">
              {t('textFormField.title')}
            </span>
          </div>
          <div data-docx-part="body" class="docx-dialog__body">
            {field(
              'defaultText',
              <input
                class="docx-dialog__input"
                value={v.defaultText}
                onInput={(e) => {
                  v.defaultText = (e.target as HTMLInputElement).value;
                }}
              />
            )}
            {field(
              'type',
              <select
                class="docx-dialog__input"
                value={v.type}
                onChange={(e) => {
                  v.type = (e.target as HTMLSelectElement).value;
                  v.format = '';
                }}
              >
                {(['regular', 'number', 'date'] as const).map((type) => (
                  <option value={type}>{t(`textFormField.${type}`)}</option>
                ))}
                {!['regular', 'number', 'date'].includes(v.type) ? (
                  <option value={v.type} disabled>
                    {t('textFormField.preservedType')}
                  </option>
                ) : null}
              </select>
            )}
            {field(
              'maxLength',
              <input
                class="docx-dialog__input"
                type="number"
                min={0}
                max={32767}
                step={1}
                value={v.maxLength}
                onInput={(e) => {
                  v.maxLength = Number((e.target as HTMLInputElement).value);
                }}
              />
            )}
            {field(
              'format',
              <select
                class="docx-dialog__input"
                value={v.format}
                onChange={(e) => {
                  v.format = (e.target as HTMLSelectElement).value;
                }}
              >
                {formats.map((format) => (
                  <option value={format}>{formatLabel(format)}</option>
                ))}
                {!formats.includes(v.format) ? (
                  <option value={v.format} disabled>
                    {v.format}
                  </option>
                ) : null}
              </select>
            )}
            {field(
              'enabled',
              <input
                type="checkbox"
                checked={v.enabled}
                onChange={(e) => {
                  v.enabled = (e.target as HTMLInputElement).checked;
                }}
              />
            )}
          </div>
          <div data-docx-part="footer" class="docx-dialog__footer">
            <span data-docx-part="error" role="alert" class="docx-dialog__error">
              {refused.value ? t('textFormField.invalidOptions') : null}
            </span>
            <button
              data-docx-part="cancel"
              class="docx-dialog__button docx-dialog__cancel"
              type="button"
              onClick={cancel}
            >
              {t('common.cancel')}
            </button>
            <button
              data-docx-part="apply"
              class="docx-dialog__button docx-dialog__apply"
              type="button"
              disabled={!isEnabled.value}
              onClick={apply}
            >
              {t('common.apply')}
            </button>
          </div>
        </Fragment>
      );
      return (
        <NativeDialog
          restoreFocus={false}
          sessionSignal={p.session.signal}
          dismissOutside={false}
          kind="textFormField"
          label={t('textFormField.title')}
          onClose={cancel}
          class={p.className}
          style={p.style}
          onKeydown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.isComposing &&
              !(e.target instanceof HTMLButtonElement) &&
              !(e.target instanceof HTMLSelectElement)
            ) {
              e.preventDefault();
              apply();
            }
          }}
          content={() => renderParts(defaults, slots.default?.() ?? [], p.preset)}
        />
      );
    };
  },
});
/** Customizable legacy text field options. @public */
export const DocxEditorTextFormFieldDialog = Object.assign(Impl, composition.parts);
