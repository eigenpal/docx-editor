import { computed, type ComputedRef } from 'vue';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from './LocaleContext';

/** @public */
export type ChromeTranslate = (key: string, params?: Record<string, string | number>) => string;

/** @public */
export function useChromeTranslate(
  overrides?: ReadonlyMap<string, string>
): ComputedRef<ChromeTranslate> {
  const { t } = useTranslation();
  return computed(
    () => (key: string, params?: Record<string, string | number>) =>
      overrides?.get(key) ?? t.value(key as TranslationKey, params)
  );
}
