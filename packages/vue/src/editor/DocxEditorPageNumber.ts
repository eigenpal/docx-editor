import {
  defineComponent,
  h,
  inject,
  ref,
  watch,
  type CSSProperties,
  type InjectionKey,
  type PropType,
} from 'vue';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { useDocxEditor } from './context';
import { useNavigationViewportElement } from './navigation/navigation-layout';
import { useEditorState } from './useEditorState';
import { useScopeClassName } from './scope-context';

const HIDE_DELAY_MS = 600;
const selectTotalPages = (snapshot: EditorSnapshot): number => snapshot.page.total;

/** Internal bridge from the batteries-included editor's `t` prop to this composition part. */
export const PageNumberTranslationContext: InjectionKey<((key: string) => string) | null> = Symbol(
  'PageNumberTranslationContext'
);

/** Props for `DocxEditor.PageNumber`. @public */
export interface DocxEditorPageNumberProps {
  className?: string;
  style?: CSSProperties;
}

/** @public */
export const DocxEditorPageNumber = defineComponent({
  name: 'DocxEditorPageNumber',
  props: {
    className: { type: String, default: undefined },
    style: { type: Object as PropType<CSSProperties>, default: undefined },
  },
  setup(props) {
    const scopeClassName = useScopeClassName();
    const editorRef = useDocxEditor();
    const viewport = useNavigationViewportElement();
    const total = useEditorState(selectTotalPages);
    const { t } = useTranslation();
    const translate = inject(PageNumberTranslationContext, null);
    const current = ref(1);
    const visible = ref(false);

    watch(
      [editorRef, total, viewport],
      ([editor, pageTotal, vp]) => {
        visible.value = false;
        if (!editor || !vp || pageTotal <= 1) return;
        current.value = editor.getCurrentPage('viewport');
        let hideTimer: ReturnType<typeof setTimeout> | null = null;
        const onScroll = () => {
          current.value = editor.getCurrentPage('viewport');
          visible.value = true;
          if (hideTimer) clearTimeout(hideTimer);
          hideTimer = setTimeout(() => {
            visible.value = false;
          }, HIDE_DELAY_MS);
        };
        vp.addEventListener('scroll', onScroll, { passive: true });
        return () => {
          vp.removeEventListener('scroll', onScroll);
          if (hideTimer) clearTimeout(hideTimer);
        };
      },
      { flush: 'post' }
    );

    return () => {
      if (total.value <= 1) return null;
      const label = translate
        ? translate('viewer.pageIndicator')
            .replace(/\{current\}/g, String(current.value))
            .replace(/\{total\}/g, String(total.value))
        : t('viewer.pageIndicator', { current: current.value, total: total.value });
      return h(
        'div',
        {
          class: `${scopeClassName}docx-editor-shell__page-indicator-chip docx-editor__page-number${
            props.className ? ` ${props.className}` : ''
          }`,
          style: props.style,
          'data-visible': visible.value ? 'true' : 'false',
          role: 'status',
          ariaLive: 'polite',
        },
        label
      );
    };
  },
});
