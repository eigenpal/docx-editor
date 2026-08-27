// Playwright oracle for collaboration review writes. Exposes `editor.save()` and
// `getReviewItems()` so a spec can read comment ids and saved packages. It does
// not write. The chrome controls still drive every mutation.

import { useEffect } from 'react';
import { useDocxEditor } from '@docx-editor.dev/react';

export interface ReviewWriteItemSnap {
  readonly id: string;
  readonly kind: string;
  readonly text: string;
  readonly author: string;
  readonly resolved: boolean;
  readonly parentId: string | null;
  readonly revisionKind: string | null;
}

declare global {
  interface Window {
    __DOCX_REVIEW_E2E__?: {
      reviewItems(): ReviewWriteItemSnap[];
      saveBytes(): Promise<number[]>;
    };
  }
}

export function ReviewWritesE2eBridge(): null {
  const editor = useDocxEditor();

  useEffect(() => {
    if (!editor) {
      delete window.__DOCX_REVIEW_E2E__;
      return undefined;
    }
    window.__DOCX_REVIEW_E2E__ = {
      reviewItems() {
        return editor.getReviewItems({ placement: false }).map((item) => ({
          id: item.id,
          kind: item.kind,
          text: item.text,
          author: item.author,
          resolved: item.kind === 'comment' ? item.resolved : false,
          parentId: item.kind === 'comment' ? (item.parentId ?? null) : null,
          revisionKind: item.kind === 'revision' ? item.revisionKind : null,
        }));
      },
      async saveBytes() {
        const buffer = await editor.save();
        return Array.from(new Uint8Array(buffer));
      },
    };
    return () => {
      delete window.__DOCX_REVIEW_E2E__;
    };
  }, [editor]);

  return null;
}
