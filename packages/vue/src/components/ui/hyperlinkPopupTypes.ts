/**
 * Shared `HyperlinkPopupData` type — imported by `HyperlinkPopup.vue`
 * (for `defineProps`) and `useHyperlinkManagement.ts` (for the
 * composable's `hyperlinkPopupData` ref). Pulled out of the .vue SFC so
 * a plain .ts module can reference it without going through the `*.vue`
 * wildcard shim, which doesn't carry named type exports.
 */

export interface HyperlinkPopupData {
  href: string;
  displayText: string;
  tooltip?: string;
  /** Popup position in the editor's pages-viewport coordinate space (CSS
   *  pixels from its top-left). Computed once at click time. The popup
   *  renders inside that viewport with `position: absolute`, so the
   *  browser handles repositioning during scroll for free. */
  position: { top: number; left: number };
}
