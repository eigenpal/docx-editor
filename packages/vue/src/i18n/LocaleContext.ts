import {
  computed,
  inject,
  provide,
  shallowRef,
  watch,
  type InjectionKey,
  type ShallowRef,
} from 'vue';
import { createT, deepMerge, en } from '@docx-editor.dev/i18n';
import type { LocaleStrings, TFunction, Translations, TranslationKey } from '@docx-editor.dev/i18n';
import { defineComponent, type PropType } from 'vue';

const localeKey: InjectionKey<ShallowRef<LocaleStrings>> = Symbol('locale');
const langKey: InjectionKey<ShallowRef<string>> = Symbol('lang');

/** @public */
export interface LocaleProviderProps {
  i18n?: Translations;
  children?: import('vue').VNode;
}

/** @public */
export const LocaleProvider = defineComponent({
  name: 'LocaleProvider',
  props: {
    i18n: { type: Object as PropType<Translations>, default: undefined },
  },
  setup(props, { slots }) {
    const inherited = inject(localeKey, shallowRef(en));
    const inheritedLang = inject(langKey, shallowRef('en'));
    const lang = computed(() =>
      typeof props.i18n?._lang === 'string' ? props.i18n._lang : inheritedLang.value
    );
    const merged = computed(() =>
      deepMerge(
        inherited.value as Record<string, unknown>,
        props.i18n as Record<string, unknown> | undefined
      )
    );
    const strings = shallowRef(merged.value as LocaleStrings);
    const langRef = shallowRef(lang.value);
    watch([merged, lang], () => {
      strings.value = merged.value as LocaleStrings;
      langRef.value = lang.value;
    });
    provide(localeKey, strings);
    provide(langKey, langRef);
    return () => slots.default?.();
  },
});

/** @public */
export function useTranslation(): { t: ShallowRef<TFunction> } {
  const strings = inject(localeKey, shallowRef(en));
  const lang = inject(langKey, shallowRef('en'));
  const t = shallowRef(createT(strings.value, lang.value));
  watch([strings, lang], () => {
    t.value = createT(strings.value, lang.value);
  });
  return { t };
}

export type { TranslationKey };
