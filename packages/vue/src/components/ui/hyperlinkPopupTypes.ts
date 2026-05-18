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
  anchorRect: DOMRect;
}
