// `DocxEditor.SidePanel`: a panel beside the pages that holds the Chart pane. The host shows
// or hides it by rendering it, and opens it when the chrome asks (`usePaneRequest`): Insert >
// Chart opens it without the focus, and Edit chart moves the focus into the Chart pane, which
// takes the request itself. The Vue twin is
// `packages/vue/src/editor/charts/SidePanel.tsx`; both render the same markup.

import { useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import { listenPaneRequests, type PaneRequest } from '@docx-editor.dev/core/editor';
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
  const editor = useDocxEditor();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(
    () => (editor ? listenPaneRequests(editor, (request) => latest.current(request)) : undefined),
    [editor]
  );
}

/** Props for `DocxEditor.SidePanel`. @public */
export interface DocxEditorSidePanelProps {
  /** A class name added to the panel. */
  className?: string;
  /** Shows a close button that calls it. */
  onClose?: () => void;
  /** Content that replaces the packaged Chart pane. It takes no focus request. */
  children?: DocxEditorChildren;
}

/** The side panel that holds the Chart pane. @public */
export function DocxEditorSidePanel({
  className,
  onClose,
  children,
}: DocxEditorSidePanelProps): ReactElement {
  const { t } = useTranslation();
  return (
    <aside
      className={`docx-side-panel${className ? ` ${className}` : ''}`}
      aria-label={t('chart.pane.title')}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !onClose || e.defaultPrevented) return;
        e.preventDefault();
        onClose();
      }}
    >
      <div className="docx-side-panel__head">
        <h2 className="docx-side-panel__title">{t('chart.pane.title')}</h2>
        {onClose ? (
          <button
            type="button"
            className="docx-side-panel__close"
            aria-label={t('chart.pane.close')}
            title={t('chart.pane.close')}
            onClick={onClose}
          >
            <MaterialSymbol name="close" size={18} />
          </button>
        ) : null}
      </div>
      <div className="docx-side-panel__body">{children ?? <DocxEditorChartPane />}</div>
    </aside>
  );
}
