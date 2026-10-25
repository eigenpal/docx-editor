import {
  computed,
  inject,
  provide,
  shallowRef,
  watch,
  type InjectionKey,
  type ShallowRef,
} from 'vue';
import { catalogDirection, chromeDirection, createT, deepMerge, en } from '@docx-editor.dev/i18n';
import type { LocaleStrings, TFunction, Translations, TranslationKey } from '@docx-editor.dev/i18n';
import { defineComponent, type PropType } from 'vue';

const localeKey: InjectionKey<ShallowRef<LocaleStrings>> = Symbol('locale');
const langKey: InjectionKey<ShallowRef<string>> = Symbol('lang');
const dirKey: InjectionKey<ShallowRef<'ltr' | 'rtl'>> = Symbol('dir');
/** The direction a provider DECIDED for the chrome; `undefined` keeps the host page's. */
const chromeDirKey: InjectionKey<ShallowRef<'ltr' | 'rtl' | undefined>> = Symbol('chromeDir');

import type { DocxEditorChildren } from '../docx-editor-children';

/** @public */
export interface LocaleProviderProps {
  i18n?: Translations;
  /**
   * The writing direction of the editor chrome. Defaults to the catalog's `_dir`, then to a
   * right-to-left `_lang`, then to the direction of an outer provider. With `'rtl'`, the
   * toolbar, menu bar, dialogs, context menu, panes, and review column mirror without a
   * wrapper element. `'ltr'` keeps a left-to-right chrome on a right-to-left host page.
   * Without any of these, as with the shipped left-to-right catalogs, the chrome inherits
   * the host page direction.
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
    const inheritedChromeDir = inject(chromeDirKey, shallowRef<'ltr' | 'rtl' | undefined>());
    const chromeDir = computed(() =>
      chromeDirection(props.dir, props.i18n, inheritedChromeDir.value)
    );
    // The decided chrome direction first, so `useTranslation().dir` agrees with the chrome.
    const dir = computed(
      () => chromeDir.value ?? catalogDirection(props.i18n) ?? inheritedDir.value
    );
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
    const chromeDirRef = shallowRef(chromeDir.value);
    watch([merged, lang, dir, chromeDir], () => {
      strings.value = merged.value as LocaleStrings;
      langRef.value = lang.value;
      dirRef.value = dir.value;
      chromeDirRef.value = chromeDir.value;
    });
    provide(localeKey, strings);
    provide(langKey, langRef);
    provide(dirKey, dirRef);
    provide(chromeDirKey, chromeDirRef);
    return () => slots.default?.();
  },
});

/**
 * The active catalogue's `t()`, the catalogue itself, and its language tag (`_lang`, `en`
 * by default), which formats numbers the way the strings around them read. Its `dir` is the
 * providers' direction, `'ltr'` when the chrome inherits a right-to-left host page; use
 * `useChromeDir()` for the direction a provider decided, `undefined` when inherited.
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
 * The `dir` attribute a chrome part sets on its root, as a read-only ref: the direction a
 * provider decided (its `dir` prop, the catalog's `_dir`, or a right-to-left `_lang`),
 * otherwise nothing, so the part keeps the host page direction.
 *
 * Read it in your own controls to follow the editor chrome: `undefined` means the chrome
 * inherits the host page direction, so set no `dir` then.
 * @public
 */
export function useChromeDir(): Readonly<ShallowRef<'ltr' | 'rtl' | undefined>> {
  return inject(chromeDirKey, shallowRef<'ltr' | 'rtl' | undefined>());
}

export type { TranslationKey };
