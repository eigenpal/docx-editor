import { defineComponent, h, type CSSProperties, type PropType, type VNode } from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { useEditorState } from './useEditorState';

const selectShowLoading = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;

/** Props for `DocxEditor.Loading`. @public */
export interface DocxEditorLoadingProps {
  when?: boolean;
  overlay?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: VNode;
}

/** Props for `DocxEditor.Loading.Spinner`. @public */
export interface DocxEditorLoadingSpinnerProps {
  className?: string;
}

/** @public */
export const DocxEditorLoadingSpinner = defineComponent({
  name: 'DocxEditorLoadingSpinner',
  props: {
    className: { type: String, default: undefined },
  },
  setup(props) {
    return () =>
      h('span', {
        class: `docx-editor__loading-spinner${props.className ? ` ${props.className}` : ''}`,
        ariaHidden: 'true',
      });
  },
});

const DocxEditorLoadingImpl = defineComponent({
  name: 'DocxEditorLoading',
  props: {
    when: { type: Boolean, default: false },
    overlay: { type: Boolean, default: false },
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props, { slots }) {
    const showLoading = useEditorState(selectShowLoading);
    const { t } = useTranslation();

    return () => {
      if (!props.when && !showLoading.value) return null;
      const classes = `docx-editor docx-editor__loading${
        props.overlay ? ' docx-editor__loading--overlay' : ''
      }${props.className ? ` ${props.className}` : ''}`;
      return h(
        'div',
        { class: classes, style: props.style, role: 'status', ariaLive: 'polite' },
        slots.default?.() ?? [
          h(DocxEditorLoadingSpinner),
          h('span', { class: 'docx-editor-sr-only' }, t.value('loading.label')),
        ]
      );
    };
  },
});

/** @public */
export interface DocxEditorLoadingComponent {
  (props: DocxEditorLoadingProps): VNode;
  readonly Spinner: typeof DocxEditorLoadingSpinner;
}

/** @public */
export const DocxEditorLoading = Object.assign(DocxEditorLoadingImpl, {
  Spinner: DocxEditorLoadingSpinner,
}) as unknown as DocxEditorLoadingComponent;
