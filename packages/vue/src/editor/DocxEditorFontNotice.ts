import { defineComponent, h, ref, type CSSProperties, type PropType } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import type { TFunction } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';
import { useEditorState } from './useEditorState';

const NONE: readonly string[] = [];
const selectFontSubstitutions = (snapshot: EditorSnapshot): readonly string[] =>
  snapshot.fontSubstitutions ?? NONE;

/** Props for `DocxEditor.FontNotice`. @public */
export interface DocxEditorFontNoticeProps {
  className?: string;
  style?: CSSProperties;
  t?: TFunction;
}

/** @public */
export const DocxEditorFontNotice = defineComponent({
  name: 'DocxEditorFontNotice',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
    t: { type: Function as PropType<TFunction>, default: undefined },
  },
  setup(props) {
    const substitutions = useEditorState(selectFontSubstitutions);
    const { t: ambient } = useTranslation();
    const dismissedKey = ref<string | null>(null);

    return () => {
      const subs = substitutions.value;
      if (subs.length === 0) return null;
      const key = subs.join('\0');
      if (dismissedKey.value === key) return null;
      const t = props.t ?? ambient;
      const fonts = subs.join(', ');
      return h(
        'div',
        {
          class: props.className ? `docx-font-notice ${props.className}` : 'docx-font-notice',
          role: 'status',
          ...(props.style ? { style: props.style } : {}),
        },
        [
          h(
            'span',
            { class: 'docx-font-notice__text' },
            t('editor.fontSubstitutionNotice', { fonts }).replace('{fonts}', fonts)
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'docx-font-notice__dismiss',
              onClick: () => {
                dismissedKey.value = key;
              },
            },
            t('common.dismiss')
          ),
        ]
      );
    };
  },
});
