// Context-fed ruler parts: `DocxEditor.HorizontalRuler` / `DocxEditor.VerticalRuler`.
//
// Thin wrappers over the props-driven `HorizontalRuler` / `VerticalRuler` components
// (which stay exported unchanged): the wrappers read `Editor.getPageSetup()` and the
// zoom REACTIVELY and feed them in. The subscription is the established pattern from
// `useFontFamily`'s options read — select the version-cached snapshot ITSELF (a new
// reference exactly when observable state moved) and re-derive the page setup keyed on
// it — because page setup is document state (a load swaps it) and the snapshot's
// identity is the one change signal for ALL document state.
//
// READ-ONLY on purpose: the engine has no page-margin or paragraph-indent command yet,
// so the wrappers pass no drag callbacks and `editable={false}`. Wiring a fake drag
// would claim a capability the engine does not have; the props-driven components remain
// available for hosts that bring their own persistence.

import { useMemo } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import { HorizontalRuler, type RulerPageSetup } from '../components/ui/HorizontalRuler';
import { VerticalRuler } from '../components/ui/VerticalRuler';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

/** Props for the context-fed ruler parts. @public */
export interface DocxEditorRulerProps {
  /** Measurement unit for tick labels. Defaults to inches. */
  unit?: 'inch' | 'cm';
  className?: string;
  style?: CSSProperties;
}

/** The current page setup and zoom, re-read when the snapshot's identity moves. */
function usePageSetup(): { pageSetup: RulerPageSetup | null; zoom: number } {
  const editor = useDocxEditor();
  const snapshot = useEditorState(selectSnapshot);
  const pageSetup = useMemo(
    () => (editor && !snapshot.isLoading ? editor.getPageSetup() : null),
    [editor, snapshot]
  );
  return { pageSetup, zoom: snapshot.zoom };
}

/**
 * The horizontal ruler as a context-fed part (`DocxEditor.HorizontalRuler`): page
 * width, margins and zoom straight from the editor. Read-only — margin and indent
 * dragging need engine commands that do not exist yet.
 *
 * @public
 */
export function DocxEditorHorizontalRuler(props: DocxEditorRulerProps): ReactElement {
  const { pageSetup, zoom } = usePageSetup();
  return (
    <HorizontalRuler
      pageSetup={pageSetup}
      zoom={zoom}
      editable={false}
      unit={props.unit ?? 'inch'}
      className={props.className ?? ''}
      style={props.style}
    />
  );
}

/**
 * The vertical ruler as a context-fed part (`DocxEditor.VerticalRuler`): page height,
 * margins and zoom straight from the editor. Read-only, like the horizontal part.
 *
 * @public
 */
export function DocxEditorVerticalRuler(props: DocxEditorRulerProps): ReactElement {
  const { pageSetup, zoom } = usePageSetup();
  return (
    <VerticalRuler
      pageSetup={pageSetup}
      zoom={zoom}
      editable={false}
      unit={props.unit ?? 'inch'}
      className={props.className ?? ''}
      style={props.style}
    />
  );
}
