import { inject, type InjectionKey } from 'vue';
import { useTranslation, type TranslationKey } from '../../i18n';

/** @public */
export type ToolbarTranslate = (key: string) => string;

/** @public */
export interface ToolbarContextValue {
  readonly t: ToolbarTranslate | undefined;
  readonly onSave: (() => void) | undefined;
}

/** @public */
export const ToolbarContext: InjectionKey<ToolbarContextValue> = Symbol('ToolbarContext');

/** @public */
export function useToolbarContext(): ToolbarContextValue {
  return inject(ToolbarContext, { t: undefined, onSave: undefined });
}

/** @public */
export function useToolbarLabelFor(t: ToolbarTranslate | undefined) {
  const { t: catalogT } = useTranslation();
  return (key: string) => t?.(key) ?? catalogT.value(key as TranslationKey);
}

/** @public */
export function useToolbarLabel() {
  const { t } = useToolbarContext();
  return useToolbarLabelFor(t);
}
