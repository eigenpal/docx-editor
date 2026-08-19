import { computed, inject, type ComputedRef, type InjectionKey, type MaybeRef, unref } from 'vue';
import { useTranslation, type TranslationKey } from '../../i18n';

/** @public */
export type ToolbarTranslate = (key: string) => string;

/** @public */
export interface ToolbarContextValue {
  readonly t: ToolbarTranslate | undefined;
  readonly onSave: (() => void) | undefined;
}

/** @public */
export const ToolbarContext: InjectionKey<MaybeRef<ToolbarContextValue>> = Symbol('ToolbarContext');

const fallback: ToolbarContextValue = { t: undefined, onSave: undefined };

/** @public */
export function useToolbarContext(): ComputedRef<ToolbarContextValue> {
  const value = inject(ToolbarContext, fallback);
  return computed(() => unref(value) as ToolbarContextValue);
}

/** @public */
export function useToolbarLabel() {
  const ctx = useToolbarContext();
  const { t: catalogT } = useTranslation();
  return (key: string) => ctx.value.t?.(key) ?? catalogT(key as TranslationKey);
}

/** @public */
export function useToolbarLabelFor(t: ToolbarTranslate | undefined) {
  const { t: catalogT } = useTranslation();
  return (key: string) => t?.(key) ?? catalogT(key as TranslationKey);
}
