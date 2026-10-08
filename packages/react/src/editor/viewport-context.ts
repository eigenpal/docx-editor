// Whether a part renders inside `DocxEditor.Viewport`, the scroll container.
//
// An overlay positioned against the viewport's wrapper must not live inside the scroller:
// there it scrolls away with the pages. A part below the viewport renders its overlay into the
// viewport's parent element instead, the same place as a sibling of the viewport.

import { createContext, useContext } from 'react';

/** True below `DocxEditor.Viewport`. */
export const InsideViewportContext = createContext(false);

/**
 * Where an overlay renders. `inside` is true below the viewport; `host` is then the viewport's
 * parent element, or null until the viewport has mounted.
 */
export function useViewportOverlayHost(viewport: HTMLElement | null): {
  readonly inside: boolean;
  readonly host: HTMLElement | null;
} {
  const inside = useContext(InsideViewportContext);
  return { inside, host: inside ? (viewport?.parentElement ?? null) : null };
}
