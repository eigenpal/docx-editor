import { toValue } from 'vue';
import {
  composeFontOrigins,
  isFontResolver,
  type FontOrigin,
  type FontResolutionRequest,
  type FontResolver,
} from '@docx-editor.dev/core/editor';
import type { MaybeRefOrGetter } from '../maybe-ref-or-getter';

/** @public */
export type FontsInput = FontOrigin;

/** @public */
export function useFonts(...origins: readonly MaybeRefOrGetter<FontsInput>[]): FontResolver {
  const reactiveOrigins = origins;
  // `toValue` calls a plain function to read a getter, which is exactly what a resolver
  // must NOT be subjected to: `googleFonts()` invoked with no argument reads
  // `request.defaultFamily` off `undefined` and throws. A marked resolver is the value,
  // never a getter for one.
  const readOrigins = (): readonly FontsInput[] =>
    reactiveOrigins.map((origin) => (isFontResolver(origin) ? origin : toValue(origin)));

  const resolver: FontResolver = (request: FontResolutionRequest) =>
    composeFontOrigins(readOrigins(), request);

  return resolver;
}
