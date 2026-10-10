import { defineComponent, h, type CSSProperties, type PropType, type VNode } from 'vue';
import type { DocxEditorChildren } from '../docx-editor-children';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { twipsToPixels } from '../lib/units';
import { useEditorState } from './useEditorState';

const selectShowLoading = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;
const selectLoadingPageSize = (snapshot: EditorSnapshot) => ({
  width: twipsToPixels(snapshot.pageSetup?.pageWidthTwips ?? 12_240) * snapshot.zoom,
  height: twipsToPixels(snapshot.pageSetup?.pageHeightTwips ?? 15_840) * snapshot.zoom,
});

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
    const pageSize = useEditorState(selectLoadingPageSize);
    const { t } = useTranslation();

    return () => {
      if (!props.when && !showLoading.value) return null;
      const classes = `docx-editor docx-editor__loading${
        props.overlay ? ' docx-editor__loading--overlay' : ''
      }${props.className ? ` ${props.className}` : ''}`;
      return h(
        'div',
        { class: classes, style: props.style, role: 'status', ariaLive: 'polite' },
        slots.default?.() ??
          h(
            'div',
            {
              class: 'docx-paginated-surface docx-editor__loading-surface',
              style: {
                width: `${pageSize.value.width}px`,
                height: `${pageSize.value.height}px`,
              },
            },
            [
              h('div', { class: 'docx-pages' }, [
                h('div', { class: 'docx-page docx-editor__loading-page' }, [
                  h('div', { class: 'docx-editor__loading-page-status' }, [
                    h(DocxEditorLoadingSpinner),
                    h('span', { class: 'docx-editor-sr-only' }, t('loading.label')),
                  ]),
                ]),
              ]),
            ]
          )
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
