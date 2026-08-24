import { defineComponent, h, type CSSProperties, type PropType, type VNode } from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { useNavigationShift } from './navigation/navigation-layout';
import { useReviewGutter } from './review-gutter';
import { useEditorState } from './useEditorState';

const selectShowLoading = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;

/** Props for `DocxEditor.Loading`. @public */
export interface DocxEditorLoadingProps {
  when?: boolean;
  overlay?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: DocxEditorChildren;
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
    const navigationShift = useNavigationShift();
    const reviewGutter = useReviewGutter();
    const { t } = useTranslation();

    return () => {
      if (!props.when && !showLoading.value) return null;
      const classes = `docx-editor docx-editor__loading${
        props.overlay ? ' docx-editor__loading--overlay' : ''
      }${props.className ? ` ${props.className}` : ''}`;
      const loadingStyle: CSSProperties = {
        '--docx-loading-inline-start': `${
          navigationShift.value + reviewGutter.value.inlineStart
        }px`,
        '--docx-loading-right': `${reviewGutter.value.inlineEnd}px`,
        ...props.style,
      };
      return h(
        'div',
        { class: classes, style: loadingStyle, role: 'status', ariaLive: 'polite' },
        slots.default?.() ??
          h('div', { class: 'docx-editor__loading-page' }, [
            h('div', { class: 'docx-editor__loading-page-status' }, [
              h(DocxEditorLoadingSpinner),
              h('span', `${t('loading.label')}…`),
            ]),
          ])
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
