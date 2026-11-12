// `DocxEditor.SidePanel`: a panel beside the pages that holds the Chart pane or the Format shape
// pane. The host shows or hides it by rendering it, and opens it when the chrome asks
// (`usePaneRequest`): Insert > Chart opens it without the focus, and Edit chart and Format shape
// move the focus into their pane, which takes the request itself. The selection picks the pane
// (`sidePanelPane`): a chart shows the Chart pane, a shape the Format shape pane, and otherwise
// the pane that was asked for last stays. The React twin is
// `packages/react/src/editor/charts/SidePanel.tsx`; both render the same markup.

import { defineComponent, ref, watch, type PropType } from 'vue';
import {
  focusChartPane,
  listenPaneRequests,
  paneTitleKey,
  selectionPane,
  takePaneRequest,
  type EditorPaneId,
  type PaneRequest,
  type PaneRequestListenerOptions,
} from '@docx-editor.dev/core/editor';
import type { DocxEditorChildren } from '../../docx-editor-children';
import { MaterialSymbol } from '../../components/ui/Icons';
import { useTranslation } from '../../i18n';
import { useDocxEditor } from '../context';
import { useEditorState } from '../useEditorState';
import { DocxEditorChartPane } from './ChartPane';
import { DocxEditorShapePane } from '../shapes/ShapePane';

/** The panes the side panel shows. */
const SIDE_PANEL_PANES = { panes: ['chart', 'shape'] } as const;

/**
 * Call `listener` for each request for a pane in `options.panes`: Insert > Chart and Edit chart
 * ask for `'chart'`, and Format shape asks for `'shape'`. The default is `['chart']`. A host
 * that hides its side panel shows it here. Listening for a pane makes its chrome available, so
 * list only the panes the host shows. @public
 */
export function usePaneRequest(
  listener: (request: PaneRequest) => void,
  options?: PaneRequestListenerOptions
): void {
  const editorRef = useDocxEditor();
  watch(
    editorRef,
    (editor, _, onCleanup) => {
      if (!editor) return;
      onCleanup(listenPaneRequests(editor, listener, options));
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
   * The default slot: content that replaces the packaged panes. When Edit chart or Format shape
   * asks for the focus, the panel moves it to the first field in this content.
   */
  children?: DocxEditorChildren;
}

/**
 * The side panel that holds the Chart pane or the Format shape pane. The default slot replaces
 * the packaged panes. @public
 */
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
    // The pane that was asked for or selected last, for a selection that picks none, so a text
    // click after a shape keeps the Format shape pane.
    const requested = ref<EditorPaneId>('chart');
    const selected = useEditorState(selectionPane);
    watch(
      selected,
      (pane) => {
        if (pane) requested.value = pane;
      },
      { immediate: true }
    );
    watch(
      editorRef,
      (editor, _, onCleanup) => {
        if (!editor) return;
        onCleanup(
          listenPaneRequests(
            editor,
            (request) => {
              requested.value = request.pane;
            },
            SIDE_PANEL_PANES
          )
        );
      },
      { immediate: true }
    );
    // The packaged panes take their own focus requests; slot content gets them here.
    watch(
      editorRef,
      (editor, _, onCleanup) => {
        if (!editor || !slots.default) return;
        const focus = () => queueMicrotask(() => focusChartPane(body.value));
        if (takePaneRequest(editor)?.focus) focus();
        onCleanup(
          listenPaneRequests(
            editor,
            () => {
              if (takePaneRequest(editor)?.focus) focus();
            },
            SIDE_PANEL_PANES
          )
        );
      },
      { immediate: true }
    );
    // Closing hands the keyboard back to the document; the drawing stays selected.
    const closePanel = (): void => {
      props.onClose?.();
      editorRef.value?.focus();
    };
    return () => {
      const pane = selected.value ?? requested.value;
      const title = t(paneTitleKey(pane));
      const close = t(pane === 'shape' ? 'shape.pane.close' : 'chart.pane.close');
      return (
        <aside
          class={['docx-side-panel', props.className].filter(Boolean).join(' ')}
          aria-label={title}
          data-pane={pane}
          onKeydown={(e: KeyboardEvent) => {
            if (e.key !== 'Escape' || !props.onClose || e.defaultPrevented) return;
            e.preventDefault();
            closePanel();
          }}
        >
          <div class="docx-side-panel__head">
            <h2 class="docx-side-panel__title">{title}</h2>
            {props.onClose ? (
              <button
                type="button"
                class="docx-side-panel__close"
                aria-label={close}
                title={close}
                onClick={closePanel}
              >
                <MaterialSymbol name="close" size={18} />
              </button>
            ) : null}
          </div>
          <div class="docx-side-panel__body" ref={body}>
            {slots.default ? (
              slots.default()
            ) : pane === 'shape' ? (
              <DocxEditorShapePane />
            ) : (
              <DocxEditorChartPane />
            )}
          </div>
        </aside>
      );
    };
  },
});
