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
  readonly registerCommentDraft: (handler: () => void) => () => void;
  readonly requestCommentDraft: () => boolean;
}

export const ReviewRailContext = createContext<ReviewRailRegistry | null>(null);
