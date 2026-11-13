import { useEffect, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';
import type { ReviewItemPlacement } from '@docx-editor.dev/core/contracts/editor';

export interface ReviewState {
  readonly items: readonly ReviewItemPlacement[];
  readonly activeKey: string | null;
}

const EMPTY: ReviewState = { items: [], activeKey: null };

/**
 * The editor's review queue and the activated item. Re-derives only when the engine's
 * review counter moves or the selection changes the activated card.
 */
export function useReviewItems(editor: Editor | null): ReviewState {
  const [state, setState] = useState<ReviewState>(EMPTY);
  useEffect(() => {
    if (!editor) {
      setState(EMPTY);
      return undefined;
    }
    let revision = -1;
    let items: readonly ReviewItemPlacement[] = [];
    let activeKey: string | null = null;
    const read = () => {
      const nextRevision = editor.getReviewRevision();
      const nextActive = editor.getActivatedReviewItemKey();
      if (nextRevision === revision && nextActive === activeKey) return;
      if (nextRevision !== revision) {
        revision = nextRevision;
        items = editor.getReviewItems({ placement: false });
      }
      activeKey = nextActive;
      setState({ items, activeKey });
    };
    read();
    const offChange = editor.on('change', read);
    const offSelection = editor.on('selectionChange', read);
    const offResolved = editor.on('reviewChangesResolved', read);
    return () => {
      offChange();
      offSelection();
      offResolved();
    };
  }, [editor]);
  return state;
}
