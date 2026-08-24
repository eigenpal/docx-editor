import type { DocxEditorChildren } from '../docx-editor-children';
import type { ReactNode } from 'react';
// The loading surface: what the host shows while there is no document to paint yet.
//
// Derives its answer from the SAME snapshot every other consumer reads, through
// `useEditorState`, so the loading screen and the chrome can never disagree about
// whether a document is ready. Renders nothing once loading ends — it is a conditional
// wrapper, not a container that stays in the tree.
//
// THE CONDITION IS `isLoading || isOpening`. `isLoading` is "no document handed over
// yet, and nothing went wrong" — NOT "nothing painted". That distinction is what makes
// `isLoading` safe to gate a `DocxEditor.Content` on: a definition keyed on painted pages
// would deadlock, since nothing paints until Content mounts and Content would never
// mount while the screen is up. It also means a host that unmounts its viewport does not
// get the loading screen back over a document that is still loaded.
//
// `isOpening` is the second half: a LARGE document mounts behind one painted frame (the
// engine yields so this very screen can paint before the blocking parse+layout), and
// `isOpening` holds for exactly that window. It is OVERLAY state — this part shows for
// it, but a host hand-gating its own mount point must key that on `isLoading` alone,
// because the scheduled mount needs the mount point to stay in the tree.
//
// `when` ORs in what the editor cannot see: the host's own async, the fetch of the DOCX
// bytes and of font faces. It is optional — the default already covers a `Root` mounted
// while its document is still on the way, which is the common shape.
//
// SELF-SUFFICIENT STYLING. The `--doc-*` tokens are defined on `.docx-editor`, and `Root`
// renders no DOM — so a part placed as a sibling of the Viewport would sit outside any
// token scope and paint an unresolved, contrast-free ring. This emits `docx-editor` itself,
// exactly as `DocxEditorViewport` does, so it looks right wherever it is composed.

import type { CSSProperties } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { useNavigationShift } from './navigation/navigation-layout';
import { useReviewGutter } from './review-gutter';
import { useEditorState } from './useEditorState';

/**
 * A scalar slice on purpose: `useEditorState` bails out on `Object.is`, so this part
 * re-renders only when the answer actually flips — not on every keystroke that bumps the
 * snapshot. `isOpening` is optional and additive in the contract; absent reads `false`.
 */
const selectShowLoading = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;

/** Props for `DocxEditor.Loading`. @public */
export interface DocxEditorLoadingProps {
  /**
   * An extra host-owned condition, OR-ed with the editor's own. OPTIONAL: the default
   * already holds the screen up while the editor has nothing painted, including a
   * `DocxEditor.Root` mounted before its document arrives. Pass this for state the
   * editor cannot see — bytes still downloading, fonts not settled — when you mount the
   * provider only after those resolve.
   */
  when?: boolean;
  /**
   * Render as an opaque overlay pinned over the nearest positioned ancestor, covering
   * the previous document while the next one opens. This is the shape for the big-file
   * case: a large document mounts behind one painted frame, and the overlay is what
   * that frame shows. It carries a short appearance delay, so an open that finishes
   * quickly never flashes it. Compose it INSIDE a positioned box (the packaged frame
   * puts it in the workspace row); without `overlay` the part is an in-flow box that
   * fills whatever the host gives it.
   */
  overlay?: boolean;
  /** Appended after the load-bearing `docx-editor docx-editor__loading` classes. */
  className?: string;
  /** Inline styles for the loading container, as on `DocxEditor.Viewport`. */
  style?: CSSProperties;
  /**
   * The loading screen. Omitted, a full-size document page with the packaged indicator
   * and localized status is used. Compose your own around `DocxEditor.Loading.Spinner`
   * to keep the packaged indicator beside your own copy.
   */
  children?: DocxEditorChildren;
}

/** Props for `DocxEditor.Loading.Spinner`. @public */
export interface DocxEditorLoadingSpinnerProps {
  /** Appended after the load-bearing `docx-editor__loading-spinner` class. */
  className?: string;
}

/**
 * The packaged spinner, on its own. Exposed because `children` replaces the default
 * screen wholesale — a host that wants "spinner plus my own label" would otherwise have
 * to hand-copy an internal class name.
 *
 * Decorative: it carries `aria-hidden`, so the surrounding live region needs its own
 * text. `DocxEditor.Loading` supplies a translated one when you pass no children.
 *
 * @public
 */
export function DocxEditorLoadingSpinner({ className }: DocxEditorLoadingSpinnerProps) {
  return (
    <span
      className={`docx-editor__loading-spinner${className ? ` ${className}` : ''}`}
      aria-hidden="true"
    />
  );
}

function DocxEditorLoadingImpl({
  when = false,
  overlay = false,
  className,
  style,
  children,
}: DocxEditorLoadingProps) {
  const showLoading = useEditorState(selectShowLoading);
  const navigationShift = useNavigationShift();
  const reviewGutter = useReviewGutter();
  const { t } = useTranslation();
  if (!when && !showLoading) return null;

  const classes = `docx-editor docx-editor__loading${
    overlay ? ' docx-editor__loading--overlay' : ''
  }${className ? ` ${className}` : ''}`;
  const loadingStyle = {
    ['--docx-loading-inline-start' as string]: `${navigationShift + reviewGutter.inlineStart}px`,
    ['--docx-loading-right' as string]: `${reviewGutter.inlineEnd}px`,
    ...style,
  } as CSSProperties;
  return (
    <div className={classes} style={loadingStyle} role="status" aria-live="polite">
      {children ?? (
        <div className="docx-editor__loading-page">
          <div className="docx-editor__loading-page-status">
            <DocxEditorLoadingSpinner />
            <span className="docx-editor-sr-only">{t('loading.label')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The loading part with the packaged spinner attached as a static.
 *
 * @public
 */
export interface DocxEditorLoadingComponent {
  /** Renders the loading screen, or nothing once a document is available. */
  (props: DocxEditorLoadingProps): ReactNode;
  /** The packaged indicator, for composing into custom children. */
  readonly Spinner: typeof DocxEditorLoadingSpinner;
}

/**
 * Renders its children while the editor is still waiting for a document, and nothing
 * once one is available. No condition to wire up in the common case:
 *
 * ```tsx
 * <DocxEditor.Root document={bytes}>
 *   <DocxEditor.Loading>
 *     <MySpinner />
 *   </DocxEditor.Loading>
 *   <DocxEditor.Viewport>
 *     <DocxEditor.Content />
 *   </DocxEditor.Viewport>
 * </DocxEditor.Root>
 * ```
 *
 * It covers TWO windows. Before bytes arrive it is the empty-state screen. And while a
 * LARGE document opens — the engine mounts it behind one painted frame precisely so this
 * screen can paint before the blocking parse and layout — it holds until the pages land;
 * pass `overlay` to pin it over the previous document for that window. A parse failure
 * clears both, so a broken document never spins forever; report that from
 * `snapshot().parseError` or the `error` event. Add `when` only for async the editor
 * cannot observe, typically a host that mounts the provider after its own fetch.
 *
 * A host gating its own `DocxEditor.Content` must key that on `snapshot().isLoading`,
 * which clears as soon as bytes are handed over — never on `isOpening`, whose scheduled
 * mount needs the mount point to stay in the tree.
 *
 * Rendered OUTSIDE a `DocxEditor.Root` it always shows, because there is no editor to
 * report otherwise — the same rule `useEditorState` documents for a null editor. Place
 * it inside the provider unless a permanently-visible placeholder is what you want.
 *
 * Carries its own `docx-editor`, so the theme tokens resolve wherever it is composed.
 *
 * @public
 */
export const DocxEditorLoading: DocxEditorLoadingComponent = Object.assign(DocxEditorLoadingImpl, {
  Spinner: DocxEditorLoadingSpinner,
});
