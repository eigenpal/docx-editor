// Vue mirror of packages/react/src/i18n/types.ts — auto-derived
// LocaleStrings + DeepPartial + Translations + DotPath types from
// the en.json source. Vue's runtime i18n (provide/inject + t())
// lives in `./index.ts`; this file exposes the type-only surface
// under the React-style filename so consumer plugins can import
// `@eigenpal/docx-editor-vue/i18n/types` portably.
import en from '@eigenpal/docx-editor-i18n/en.json';

export type LocaleStrings = typeof en;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] | null;
};

export type PartialLocaleStrings = DeepPartial<LocaleStrings>;

export type Translations = PartialLocaleStrings;

type DotPath<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? DotPath<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = DotPath<LocaleStrings>;
