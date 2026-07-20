/**
 * Shared `ImageSelectionInfo` type — imported by
 * `ImageSelectionOverlay.vue` (for `defineProps`) and
 * `useImageActions.ts` (for the composable's `selectedImage` ref).
 * Pulled out of the .vue SFC so a plain .ts module can reference it
 * without going through the `*.vue` wildcard shim, which doesn't
 * carry named type exports.
 */

export interface ImageSelectionInfo {
  element: HTMLElement;
  pmPos: number;
  width: number;
  height: number;
}
