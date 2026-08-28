import { toValue } from 'vue';
import {
  composeFontOrigins,
  defineFontResolver,
  isFontResolver,
  type FontConfigurationFragment,
  type FontOrigin,
  type FontResolutionRequest,
  type FontResolver,
  type MarkedFontResolver,
} from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';

/** @public */
export type FontsInput =
  | FontConfiguration
  | FontConfigurationFragment
  | FontResolver
  | Promise<FontConfiguration | FontConfigurationFragment | undefined>
  | undefined;

/**
 * Whether `toValue` may call this origin.
 *
 * `toValue` invokes a plain function to read a getter, and a resolver invoked with no
 * argument reads `request.defaultFamily` off `undefined` and throws — which is how
 * `useFonts(googleFonts())` came to leave the document on fixed measurement with no
 * diagnostic at all.
 *
 * The mark answers it for a marked resolver. For an unmarked one, ARITY answers it, and
 * soundly in this one direction: a getter is `() => T` and never declares a parameter, so
 * a function that declares one cannot be a getter. The converse — reading a zero-arity
 * function as a resolver — is the unsound test this codebase refuses elsewhere, and is not
 * what this does. A getter written `(unused) => value` is read as a value and then called
 * with a request it ignores, which answers the same either way.
 */
const isValueNotGetter = (origin: unknown): boolean =>
  isFontResolver(origin) || (typeof origin === 'function' && origin.length >= 1);

/** @public */
export function useFonts(
  source: MaybeRefOrGetter<FontsInput>,
  ...fragments: readonly MaybeRefOrGetter<FontConfigurationFragment | undefined>[]
): MarkedFontResolver;
/** @public */
export function useFonts(...origins: readonly MaybeRefOrGetter<FontOrigin>[]): MarkedFontResolver;
export function useFonts(
  ...origins: readonly MaybeRefOrGetter<FontsInput | FontOrigin>[]
): MarkedFontResolver {
  const reactiveOrigins = origins;
  const readOrigins = (): readonly FontOrigin[] =>
    reactiveOrigins.map((origin) =>
      isValueNotGetter(origin) ? origin : toValue(origin)
    ) as readonly FontOrigin[];

  // Marked, so this composition can itself be an origin of another list or
  // `useDocxSource`'s `fonts` option without being read as a zero-argument loader.
  return defineFontResolver((request: FontResolutionRequest) =>
    composeFontOrigins(readOrigins(), request)
  );
}
