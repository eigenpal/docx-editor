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

/**
 * The element the engine paints pages into, while one is attached. Chrome with no element of
 * its own resolves the editor's document and window from it: a pop-out window or an iframe
 * when the host moved the editor there.
 *
 * @internal
 */
export const editorContentElementKey: InjectionKey<ShallowRef<HTMLElement | null>> =
  Symbol('editorContentElement');

/** @internal */
export function useEditorContentElement(): ShallowRef<HTMLElement | null> {
  return inject(editorContentElementKey, shallowRef(null));
}

/** @internal */
export function useEditorStateTick(): ShallowRef<number> {
  return inject(editorStateTickKey, shallowRef(0));
}

/** @public */
export interface ReviewRailRegistry {
  /**
   * Review columns registered through `register`: the packaged rail, and any column that
   * serves comment drafts. The Add comment controls in the toolbar and the context menu
   * appear only while this is above zero.
   */
  readonly mounted: number;
  /**
   * Register a review column that serves comment drafts. Also reserves the review gutter.
   * Call it on mount, together with `registerCommentDraft`. Returns the unregister function.
   */
  readonly register: () => () => void;
  /**
   * Claims registered through `reserveGutter`: columns that need the review gutter but
   * serve no comment draft. The viewport reserves the gutter while `mounted + gutters` is
   * above zero.
   */
  readonly gutters?: number;
  /** Reserve the review gutter without showing comment controls. Returns the release. */
  readonly reserveGutter?: () => () => void;
  /**
   * Receive the Add comment requests. The handler takes no arguments: it reads the
   * selection's position with `getSelectionPlacement`, pins the selection with
   * `retainSelection`, and opens the pane. Release the pin with `releaseSelection` when the
   * draft closes or is cancelled. The most recently registered handler receives each request. Do not register
   * while the column cannot open a draft, such as in viewing mode: a request counts as
   * served once a handler runs. Returns the unregister function.
   */
  readonly registerCommentDraft: (handler: () => void) => () => void;
  /**
   * Send an Add comment request to the latest handler. Returns `true` when a handler ran,
   * even if it then opened nothing, and `false` when none is registered.
   */
  readonly requestCommentDraft: () => boolean;
}

/** Whether anything under the Root claims the review gutter. @internal */
export function claimsReviewGutter(registry: ReviewRailRegistry | null | undefined): boolean {
  return (registry?.mounted ?? 0) + (registry?.gutters ?? 0) > 0;
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
