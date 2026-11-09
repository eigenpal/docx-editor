// `DocxEditor.SidePanel`: a panel beside the pages that holds the Chart pane. The host shows
// or hides it by rendering it, and opens it when the chrome asks (`usePaneRequest`): Insert >
// Chart opens it without the focus, and Edit chart moves the focus into the Chart pane, which
// takes the request itself. The React twin is
// `packages/react/src/editor/charts/SidePanel.tsx`; both render the same markup.

import { defineComponent, ref, watch, type PropType } from 'vue';
import {
  focusChartPane,
  listenPaneRequests,
  takePaneRequest,
  type PaneRequest,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { MaterialSymbol } from '../../components/ui/Icons';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { DocxEditorChartPane } from './ChartPane';

/**
 * Call `listener` for each pane request of the editor: Insert > Chart and Edit chart send one.
 * A host that hides its side panel shows it here. @public
 */
export function usePaneRequest(listener: (request: PaneRequest) => void): void {
  const editorRef = useDocxEditor();
  watch(
    editorRef,
    (editor, _, onCleanup) => {
      if (!editor) return;
      onCleanup(listenPaneRequests(editor, listener));
    },
    { immediate: true }
  );
}

/** Props for `DocxEditor.SidePanel`. @public */
export interface DocxEditorSidePanelProps {
  /** A class name added to the panel. */
  className?: string;
  /** Shows a close button that calls it. */
  onClose?: () => void;
  /**
   * The default slot: content that replaces the packaged Chart pane. When Edit chart asks for
   * the focus, the panel moves it to the first field in this content.
   */
  children?: DocxEditorChildren;
}

/** The side panel that holds the Chart pane. The default slot replaces the pane. @public */
export const DocxEditorSidePanel = defineComponent({
  name: 'DocxEditorSidePanel',
  props: {
    className: { type: String, default: undefined },
    onClose: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props, { slots }) {
    const { t } = useTranslation();
    const editorRef = useDocxEditor();
    const body = ref<HTMLElement | null>(null);
    // The packaged pane takes its own focus requests; slot content gets them here.
    watch(
      editorRef,
      (editor, _, onCleanup) => {
        if (!editor || !slots.default) return;
        const focus = () => queueMicrotask(() => focusChartPane(body.value));
        if (takePaneRequest(editor)?.focus) focus();
        onCleanup(
          listenPaneRequests(editor, () => {
            if (takePaneRequest(editor)?.focus) focus();
          })
        );
      },
      { immediate: true }
    );
    return () => (
      <aside
        class={['docx-side-panel', props.className].filter(Boolean).join(' ')}
        aria-label={t('chart.pane.title')}
        onKeydown={(e: KeyboardEvent) => {
          if (e.key !== 'Escape' || !props.onClose || e.defaultPrevented) return;
          e.preventDefault();
          props.onClose();
        }}
      >
        <div class="docx-side-panel__head">
          <h2 class="docx-side-panel__title">{t('chart.pane.title')}</h2>
          {props.onClose ? (
            <button
              type="button"
              class="docx-side-panel__close"
              aria-label={t('chart.pane.close')}
              title={t('chart.pane.close')}
              onClick={() => props.onClose?.()}
            >
              <MaterialSymbol name="close" size={18} />
            </button>
          ) : null}
        </div>
        <div class="docx-side-panel__body" ref={body}>
          {slots.default ? slots.default() : <DocxEditorChartPane />}
        </div>
      </aside>
    );
  },
});
