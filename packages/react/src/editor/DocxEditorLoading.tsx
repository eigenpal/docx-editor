// The loading surface: what the host shows while there is no document to paint yet.
//
// Reads the SAME `isLoading` every other consumer sees, through `useEditorState`, so
// the loading screen and the chrome can never disagree about whether a document is
// ready. Renders nothing once loading ends — it is a conditional wrapper, not a
// container that stays in the tree.
//
// TWO PHASES, ONE SURFACE. The editor's own `isLoading` covers the window before an
// instance exists: server rendering, the first client render, and the commit in which
// `DocxEditor.Root` creates the facade. It does NOT cover the host's own async — the
// fetch of the DOCX bytes and of font faces, which happens before `Root` can be handed
// a `document` at all, and which in practice is the long part. `when` ORs that host-owned
// condition in, so one declaration spans both phases instead of a hand-rolled ternary
// outside the provider plus this component inside it.

import type { ReactNode } from 'react';
import type { EditorSnapshot } from '@docx-editor.dev/core-contract/contracts/editor';
import { useEditorState } from './useEditorState';

const selectIsLoading = (snapshot: EditorSnapshot) => snapshot.isLoading;

/** Props for `DocxEditor.Loading`. @public */
export interface DocxEditorLoadingProps {
  /**
   * A host-owned loading condition, OR-ed with the editor's own. Pass the state that
   * guards your `document` prop — bytes still downloading, fonts not settled — so the
   * one surface covers the host's async as well as the engine's.
   */
  when?: boolean;
  /** Appended after the load-bearing `docx-editor__loading` class. */
  className?: string;
  /**
   * The loading screen. Omitted, a neutral spinner rendered from the `--doc-*` tokens
   * is used, so the batteries-included path has something to show.
   */
  children?: ReactNode;
}

/**
 * Renders its children while the editor has no document to paint, and nothing once it
 * does. Use it to supply a custom loading screen:
 *
 * ```tsx
 * <DocxEditor.Root document={bytes}>
 *   <DocxEditor.Loading when={!bytes}>
 *     <MySpinner />
 *   </DocxEditor.Loading>
 *   <DocxEditor.Viewport>
 *     <DocxEditor.Content />
 *   </DocxEditor.Viewport>
 * </DocxEditor.Root>
 * ```
 *
 * Rendered OUTSIDE a `DocxEditor.Root` it always shows, because there is no editor to
 * report otherwise — the same rule `useEditorState` documents for a null editor. Place
 * it inside the provider unless a permanently-visible placeholder is what you want.
 *
 * @public
 */
export function DocxEditorLoading({ when = false, className, children }: DocxEditorLoadingProps) {
  const isLoading = useEditorState(selectIsLoading);
  if (!when && !isLoading) return null;

  return (
    <div
      className={`docx-editor__loading${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
    >
      {children ?? <span className="docx-editor__loading-spinner" aria-hidden="true" />}
    </div>
  );
}
