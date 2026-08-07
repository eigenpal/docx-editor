// The provider-first composition layer's one piece of shared state: the editor instance.
//
// `DocxEditorRoot` owns the facade's lifetime and publishes it here; `DocxEditorContent`
// and every hook read it. The value is `null` until the Root's mount effect has run —
// hooks answer with honest loading state rather than throwing, so a toolbar can render
// on the very first frame without guarding.

import { createContext, useContext } from 'react';
import type { DocxEditorInstance } from '@docx-editor.dev/core/editor';

export const DocxEditorContext = createContext<DocxEditorInstance | null>(null);

/**
 * The editor instance from the nearest `DocxEditor.Root`, or `null` before the Root's
 * mount effect has created it (and outside any Root). Deliberately not a throwing
 * variant: pre-mount is a normal frame every consumer renders through, and the state
 * hooks built on this already answer it with a typed loading snapshot.
 *
 * @public
 */
export function useDocxEditor(): DocxEditorInstance | null {
  return useContext(DocxEditorContext);
}

/**
 * Whether a review rail is mounted under this Root, and how much room it wants.
 *
 * The GUTTER is the reason this exists. `DocxEditor.Viewport` reserves space beside the
 * page for the pane, and the ruler shifts by the same amount — but neither of them can see
 * whether a rail was actually composed in. Keyed on the pane's open state alone, every
 * consumer of the tier-2 `<DocxEditor>` sugar (which mounts no rail) had its page pushed
 * 158px off centre beside an empty column.
 *
 * A rail registers on mount and unregisters on unmount, so the reservation follows what is
 * really on screen. Count rather than boolean: StrictMode mounts twice, and a host may
 * legitimately compose two rails.
 */
export interface ReviewRailRegistry {
  readonly mounted: number;
  readonly register: () => () => void;
}

export const ReviewRailContext = createContext<ReviewRailRegistry | null>(null);

/**
 * How the review pane presents itself: beside the document, or over it.
 *
 * `'rail'` is the desktop shape — the viewport reserves a gutter and each card is anchored
 * beside the text it annotates. `'drawer'` is what a narrow editor gets: the gutter is given
 * back, the document refits to the full width, and the pane opens as an overlay.
 *
 * The threshold is CONTAINER geometry, not a media query. This editor is embedded, so a
 * 700px column on a 2560px monitor is a narrow editor and a media query would call it wide.
 *
 * @public
 */
export type ReviewPaneLayout = 'rail' | 'drawer';

/**
 * The layout published by the nearest `DocxEditor.Viewport`.
 *
 * On the Viewport rather than {@link ReviewRailRegistry} because the Viewport is the element
 * whose width decides the answer; the registry is created up in the Root, which has none.
 * `'rail'` outside a Viewport, so a rail composed on its own keeps the desktop shape.
 */
export const ReviewLayoutContext = createContext<ReviewPaneLayout>('rail');

/**
 * How the review pane is presenting itself right now.
 *
 * @public
 */
export function useReviewPaneLayout(): ReviewPaneLayout {
  return useContext(ReviewLayoutContext);
}
