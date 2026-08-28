import { toValue } from 'vue';
import {
  composeFontOrigins,
  defineFontResolver,
  isFontResolver,
  type FontOrigin,
  type FontResolutionRequest,
  type MarkedFontResolver,
} from '@docx-editor.dev/core/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';

/** @public */
export type FontsInput = FontOrigin;

/** @public */
export function useFonts(...origins: readonly MaybeRefOrGetter<FontsInput>[]): MarkedFontResolver {
  const reactiveOrigins = origins;
  // `toValue` calls a plain function to read a getter, which is exactly what a resolver
  // must NOT be subjected to: `googleFonts()` invoked with no argument reads
  // `request.defaultFamily` off `undefined` and throws. A marked resolver is the value,
  // never a getter for one.
  const readOrigins = (): readonly FontsInput[] =>
    reactiveOrigins.map((origin) => (isFontResolver(origin) ? origin : toValue(origin)));

  // Marked, so this composition can itself be an origin of another list or
  // `useDocxSource`'s `fonts` option without being read as a zero-argument loader.
  return defineFontResolver((request: FontResolutionRequest) =>
    composeFontOrigins(readOrigins(), request)
  );
}
