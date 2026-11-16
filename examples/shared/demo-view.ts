// View settings of the demo that are not editor state: whether the rulers show. The choice is
// saved in this browser, and the React and Vue examples share it. Also the zoom both use.
import type { ZoomMode } from '@docx-editor.dev/core';

/**
 * The demo's zoom: the page fits the width of its column, never past 100% and down to 25%, as
 * on the site. The default (`'auto'`) stops at 50%, so a phone would scroll the page sideways.
 */
export const DEMO_ZOOM_MODE: ZoomMode = {
  type: 'fit',
  fit: 'pageWidth',
  minZoom: 0.25,
  maxZoom: 1,
};

const RULERS_KEY = 'docx-editor-demo.rulers';

/** Whether the rulers show. They are off until the reader turns them on. */
export function storedRulers(): boolean {
  try {
    return globalThis.localStorage?.getItem(RULERS_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Save whether the rulers show. Off is the default, so it removes the saved value. */
export function saveRulers(show: boolean): void {
  try {
    if (show) globalThis.localStorage?.setItem(RULERS_KEY, 'on');
    else globalThis.localStorage?.removeItem(RULERS_KEY);
  } catch {
    // Storage can be blocked; the choice then lasts for this page only.
  }
}
