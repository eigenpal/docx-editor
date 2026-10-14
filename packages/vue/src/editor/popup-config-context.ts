// The popup registry context alone. `popup-config.ts` imports every packaged popup, and those
// import the menu and toolbar parts; a part that reads one popup entry imports this module
// instead, so it never joins that import cycle.
import { computed, inject, type ComputedRef, type InjectionKey } from 'vue';
import type { DocxEditorPopups } from './popup-config';

export const popupConfigKey: InjectionKey<ComputedRef<DocxEditorPopups | undefined>> =
  Symbol('docx.popups');

/** The popup registry the nearest editor root provides. */
export function usePopupConfig(): ComputedRef<DocxEditorPopups | undefined> {
  return inject(
    popupConfigKey,
    computed(() => undefined)
  );
}
