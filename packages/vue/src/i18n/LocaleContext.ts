import {
  computed,
  inject,
  provide,
  shallowRef,
  watch,
  type InjectionKey,
  type ShallowRef,
} from 'vue';
import { catalogDirection, createT, deepMerge, en } from '@docx-editor.dev/i18n';
import type { LocaleStrings, TFunction, Translations, TranslationKey } from '@docx-editor.dev/i18n';
import { defineComponent, type PropType } from 'vue';

const localeKey: InjectionKey<ShallowRef<LocaleStrings>> = Symbol('locale');
const langKey: InjectionKey<ShallowRef<string>> = Symbol('lang');
const dirKey: InjectionKey<ShallowRef<'ltr' | 'rtl'>> = Symbol('dir');

import type { DocxEditorChildren } from '../docx-editor-children';

/** @public */
export interface LocaleProviderProps {
  i18n?: Translations;
  /**
   * The writing direction of the editor chrome. Defaults to the catalog's `_dir`, then to
   * its `_lang`, then to the direction of an outer provider. With `'rtl'`, the toolbar, menu
   * bar, dialogs, context menu, and panes mirror without a wrapper element.
   */
  dir?: 'ltr' | 'rtl';
  children?: DocxEditorChildren;
}

/** @public */
export const LocaleProvider = defineComponent({
  name: 'LocaleProvider',
  props: {
    i18n: { type: Object as PropType<Translations>, default: undefined },
    dir: { type: String as PropType<'ltr' | 'rtl'>, default: undefined },
  },
  setup(props, { slots }) {
    const inherited = inject(localeKey, shallowRef(en));
    const inheritedLang = inject(langKey, shallowRef('en'));
    const inheritedDir = inject(dirKey, shallowRef<'ltr' | 'rtl'>('ltr'));
    const dir = computed(() => props.dir ?? catalogDirection(props.i18n) ?? inheritedDir.value);
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
    const dirRef = shallowRef(dir.value);
    watch([merged, lang, dir], () => {
      strings.value = merged.value as LocaleStrings;
      langRef.value = lang.value;
      dirRef.value = dir.value;
    });
    provide(localeKey, strings);
    provide(langKey, langRef);
    provide(dirKey, dirRef);
    return () => slots.default?.();
  },
});

/**
 * The active catalogue's `t()`, the catalogue itself, and its language tag (`_lang`, `en`
 * by default), which formats numbers the way the strings around them read.
 * @public
 */
export function useTranslation(): {
  t: TFunction;
  catalogue: ShallowRef<LocaleStrings>;
  lang: string;
  dir: 'ltr' | 'rtl';
} {
  const strings = inject(localeKey, shallowRef(en));
  const lang = inject(langKey, shallowRef('en'));
  const dir = inject(dirKey, shallowRef<'ltr' | 'rtl'>('ltr'));
  const t = shallowRef(createT(strings.value, lang.value));
  watch([strings, lang], () => {
    t.value = createT(strings.value, lang.value);
  });
  return {
    catalogue: strings,
    get t() {
      return t.value;
    },
    get lang() {
      return lang.value;
    },
    get dir() {
      return dir.value;
    },
  };
}

/**
 * The `dir` attribute a chrome part sets on its root, read during render: `'rtl'` under a
 * right-to-left provider, otherwise nothing, so the part keeps the host page direction.
 * @internal
 */
export function useChromeDir(): () => 'rtl' | undefined {
  const dir = inject(dirKey, shallowRef<'ltr' | 'rtl'>('ltr'));
  return () => (dir.value === 'rtl' ? 'rtl' : undefined);
}

export type { TranslationKey };
