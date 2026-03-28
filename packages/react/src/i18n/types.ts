import en from '../../i18n/en.json';

/** Auto-derived from en.json — never manually maintained */
export type LocaleStrings = typeof en;

/** Recursively makes all properties optional */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] | null;
};

export type PartialLocaleStrings = DeepPartial<LocaleStrings>;

/** Consumer-facing type for the i18n prop. */
export type Translations = PartialLocaleStrings;

/** Generates a union of all valid dot-notation paths through a nested object type */
type DotPath<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Record<string, unknown>
    ? DotPath<T[K], `${Prefix}${K}.`>
    : `${Prefix}${K}`;
}[keyof T & string];

export type TranslationKey = DotPath<LocaleStrings>;
