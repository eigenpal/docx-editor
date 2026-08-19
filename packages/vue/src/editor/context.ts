import { inject, shallowRef, type InjectionKey, type ShallowRef } from 'vue';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

/** @public */
export const docxEditorKey: InjectionKey<ShallowRef<DocxEditorInstance | null>> =
  Symbol('docxEditor');

/** @internal */
export const editorStateTickKey: InjectionKey<ShallowRef<number>> = Symbol('editorStateTick');

const nullEditorRef = shallowRef<DocxEditorInstance | null>(null);

/** @public */
export function useDocxEditor(): ShallowRef<DocxEditorInstance | null> {
  return inject(docxEditorKey, nullEditorRef);
}

/** @internal */
export function useEditorStateTick(): ShallowRef<number> {
  return inject(editorStateTickKey, shallowRef(0));
}

/** @public */
export interface ReviewRailRegistry {
  readonly mounted: number;
  readonly register: () => () => void;
  readonly registerCommentDraft: (handler: () => void) => () => void;
  readonly requestCommentDraft: () => boolean;
}

/** @public */
export const ReviewRailContext: InjectionKey<ShallowRef<ReviewRailRegistry>> =
  Symbol('ReviewRailContext');

/** @internal */
export function useReviewRailRegistry(): ShallowRef<ReviewRailRegistry> {
  const fallback = shallowRef<ReviewRailRegistry>({
    mounted: 0,
    register: () => () => {},
    registerCommentDraft: () => () => {},
    requestCommentDraft: () => false,
  });
  return inject(ReviewRailContext, fallback);
}
