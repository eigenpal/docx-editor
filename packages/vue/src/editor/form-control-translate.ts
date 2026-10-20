import { inject, type ComputedRef, type InjectionKey } from 'vue';
import type { TranslationKey } from '@docx-editor.dev/i18n';
import { useTranslation } from '../i18n';

type FormControlTranslate = (key: string, params?: Record<string, string | number>) => string;

/** @internal Shared resolver for native and adapter-owned form controls. */
export const formControlTranslateKey: InjectionKey<ComputedRef<FormControlTranslate>> =
  Symbol('formControlTranslate');

/** @internal Read the live Root resolver, with standalone catalogue fallback. */
export function useFormControlTranslate(): FormControlTranslate {
  const resolver = inject(formControlTranslateKey, undefined);
  const translation = useTranslation();
  return (key, params) => {
    const translated = resolver?.value(key, params);
    return translated === undefined || translated === key
      ? translation.t(key as TranslationKey, params)
      : translated;
  };
}
