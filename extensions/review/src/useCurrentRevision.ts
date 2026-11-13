import { useEffect, useState } from 'react';
import type { Editor } from '@docx-editor.dev/core/contracts/editor';

/**
 * The key of the tracked change the caret is in, as Word's Accept and Reject act on: the
 * change Next/Previous Change activated, else the one the caret sits in. `null` outside any
 * change.
 */
export function useCurrentRevision(editor: Editor | null): string | null {
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    if (!editor) {
      setKey(null);
      return undefined;
    }
    const read = () => {
      const items = editor.getReviewItems({ placement: false });
      const activated = editor.getActivatedReviewItemKey();
      const current =
        items.find((item) => item.kind === 'revision' && item.key === activated) ??
        items.find((item) => item.kind === 'revision' && item.isActive);
      setKey(current?.key ?? null);
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
  return key;
}
