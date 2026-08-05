// The loading surface: what the host shows while there is no document to paint yet.
//
// Derives its answer from the SAME snapshot every other consumer reads, through
// `useEditorState`, so the loading screen and the chrome can never disagree about
// whether a document is ready. Renders nothing once loading ends — it is a conditional
// wrapper, not a container that stays in the tree.
//
// THE CONDITION IS `isLoading`, which the facade defines as "no document handed over
// yet, and nothing went wrong" — NOT "nothing painted". That distinction is what makes
// this part safe to gate a `DocxEditor.Content` on: a definition keyed on painted pages
// would deadlock, since nothing paints until Content mounts and Content would never
// mount while the screen is up. It also means a host that unmounts its viewport does not
// get the loading screen back over a document that is still loaded.
//
// `when` ORs in what the editor cannot see: the host's own async, the fetch of the DOCX
// bytes and of font faces. It is optional — the default already covers a `Root` mounted
// while its document is still on the way, which is the common shape.
//
// SELF-SUFFICIENT STYLING. The `--doc-*` tokens are defined on `.ep-root`, and `Root`
// renders no DOM — so a part placed as a sibling of the Viewport would sit outside any
// token scope and paint an unresolved, contrast-free ring. This emits `ep-root` itself,
// exactly as `DocxEditorViewport` does, so it looks right wherever it is composed.

import type { CSSProperties, ReactNode } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { useTranslation } from '../i18n';
import { useEditorState } from './useEditorState';

/**
 * A scalar slice on purpose: `useEditorState` bails out on `Object.is`, so this part
 * re-renders only when the answer actually flips — not on every keystroke that bumps the
 * snapshot.
 */
const selectIsLoading = (snapshot: EditorSnapshot) => snapshot.isLoading;

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
  /** Appended after the load-bearing `ep-root docx-editor__loading` classes. */
  className?: string;
  /** Inline styles for the loading container, as on `DocxEditor.Viewport`. */
  style?: CSSProperties;
  /**
   * The loading screen. Omitted, a neutral spinner rendered from the `--doc-*` tokens is
   * used, so the batteries-included path has something to show. Compose your own around
   * `DocxEditor.Loading.Spinner` to keep the packaged indicator beside your own copy.
   */
  children?: ReactNode;
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
  className,
  style,
  children,
}: DocxEditorLoadingProps) {
  const isLoading = useEditorState(selectIsLoading);
  const { t } = useTranslation();
  if (!when && !isLoading) return null;

  return (
    <div
      className={`ep-root docx-editor__loading${className ? ` ${className}` : ''}`}
      style={style}
      role="status"
      aria-live="polite"
    >
      {children ?? (
        <>
          <DocxEditorLoadingSpinner />
          {/* The spinner is decorative, so the live region would otherwise announce an
              empty string — worse than having no region at all. */}
          <span className="ep-sr-only">{t('loading.label')}</span>
        </>
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
 * It clears as soon as bytes are handed over — NOT when pages finish painting — so it is
 * safe to gate a `DocxEditor.Content` on, and an unmounted viewport does not bring it
 * back. A parse failure clears it too, so a broken document never spins forever; report
 * that from `snapshot().parseError` or the `error` event. Add `when` only for async the
 * editor cannot observe, typically a host that mounts the provider after its own fetch.
 *
 * Rendered OUTSIDE a `DocxEditor.Root` it always shows, because there is no editor to
 * report otherwise — the same rule `useEditorState` documents for a null editor. Place
 * it inside the provider unless a permanently-visible placeholder is what you want.
 *
 * Carries its own `ep-root`, so the theme tokens resolve wherever it is composed.
 *
 * @public
 */
export const DocxEditorLoading: DocxEditorLoadingComponent = Object.assign(DocxEditorLoadingImpl, {
  Spinner: DocxEditorLoadingSpinner,
});
