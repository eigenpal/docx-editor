// Context-fed outline part: `DocxEditor.DocumentOutline`.
//
// A thin wrapper over the props-driven `DocumentOutline` panel: headings come from
// `Editor.getOutline()` (the session's per-revision heading derivation), re-read on the
// version-cached snapshot's identity — the same subscription pattern as `useFontFamily`
// and the ruler parts — so the panel follows edits (retitling, adding or deleting a
// heading) without a bespoke channel.
//
// A heading click both MOVES THE CARET and BRINGS THE HEADING INTO VIEW: the selection
// goes to the heading paragraph's start through the facade's semantic `setSelection`, and
// `scrollToBlock` reveals it. The two are separate because moving the caret does not move
// the viewport — a heading twenty pages down was selected where nobody could see it.
// The reveal resolves through layout rather than the DOM, so it works for a page that has
// not been materialized yet, which is exactly the page an outline jump asks for.

import { useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
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
      // Anchor and head equal is what a caret is, so this collapses the selection at the
      // start of the heading rather than selecting it.
      const position = { paragraphId: blockId, offset: 0 };
      editor.exec({
        type: 'setSelection',
        range: { anchor: position, head: position },
      });
      // Moving the caret does not move the VIEWPORT — a heading twenty pages down was
      // selected where the user could not see it. The engine knows which page the block
      // is on, so the outline asks it to reveal rather than reaching into the DOM.
      editor.scrollToBlock(blockId);
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
