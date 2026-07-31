// Context-fed outline part: `DocxEditor.DocumentOutline`.
//
// A thin wrapper over the props-driven `DocumentOutline` panel: headings come from
// `Editor.getOutline()` (the session's per-revision heading derivation), re-read on the
// version-cached snapshot's identity — the same subscription pattern as `useFontFamily`
// and the ruler parts — so the panel follows edits (retitling, adding or deleting a
// heading) without a bespoke channel.
//
// NAVIGATION IS THE CARET, not a scroll. A heading click focuses the surface and moves
// the selection to the heading paragraph's start through the facade's semantic
// `setSelection`. The engine has no caret-scroll-into-view yet (`scrollToBlock` is an
// honest stub), so the wrapper does not pretend to scroll; when the engine grows that
// capability the same click starts navigating visually with no adapter change.

import { useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import { DocumentOutline, type OutlineHeading } from '../components/DocumentOutline';
import { useDocxEditor } from './context';
import { useEditorState } from './useEditorState';

const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;
const EMPTY_OUTLINE: readonly OutlineHeading[] = Object.freeze([]);
const NOOP = () => {};

/** Props for the context-fed outline part. @public */
export interface DocxEditorDocumentOutlineProps {
  /** Close-button handler; without one the panel simply stays open. */
  onClose?: () => void;
  /** Vertical offset (px) inside the panel's positioning container. */
  topOffset?: number;
  /** Left anchor (px) inside the panel's positioning container. */
  leftOffset?: number;
}

/**
 * The document outline as a context-fed part (`DocxEditor.DocumentOutline`): headings
 * from `Editor.getOutline()`, in document order; clicking one moves the caret to that
 * heading. The panel positions absolutely — give it a `position: relative` container.
 *
 * @public
 */
export function DocxEditorDocumentOutline(props: DocxEditorDocumentOutlineProps): ReactElement {
  const editor = useDocxEditor();
  const snapshot = useEditorState(selectSnapshot);
  const headings = useMemo(
    () => (editor && !snapshot.isLoading ? editor.getOutline() : EMPTY_OUTLINE),
    [editor, snapshot]
  );

  const handleHeadingClick = useCallback(
    (blockId: string) => {
      if (!editor) return;
      // Focus first, so the surface owns the selection it is about to paint.
      editor.focus();
      const position = { paragraphId: blockId, offset: 0 };
      // The paragraph-id/offset endpoints are the ONE selection form the tree surface
      // honours; the declared `EditorSelection` union does not spell it yet, so this
      // casts exactly the way the facade's own setSelection test does.
      editor.exec({
        type: 'setSelection',
        range: { anchor: position, head: position } as never,
      });
    },
    [editor]
  );

  return (
    <DocumentOutline
      headings={headings}
      onHeadingClick={handleHeadingClick}
      onClose={props.onClose ?? NOOP}
      topOffset={props.topOffset ?? 0}
      {...(props.leftOffset !== undefined ? { leftOffset: props.leftOffset } : {})}
    />
  );
}
