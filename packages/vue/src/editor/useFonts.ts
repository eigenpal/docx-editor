import { toValue } from 'vue';
import {
  composeFontOrigins,
  defineFontResolver,
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
 * Read one origin, resolving a `ref` but NEVER calling a function.
 *
 * `toValue` invokes a plain function to read it as a getter, and a resolver invoked with
 * no argument reads `request.defaultFamily` off `undefined` and throws — which is how
 * `useFonts(googleFonts())` came to leave the document on fixed measurement with no
 * diagnostic at all.
 *
 * Arity looked like a way to tell the two apart and is not one. A getter never declares a
 * parameter, so "declares one ⇒ not a getter" is sound — but the branch it falls THROUGH
 * to is the mirror-image unsound move, reading a zero-arity function as a getter and
 * calling it. `(request = FALLBACK) => …` and `(...args) => …` are both length 0 and both
 * resolvers, and this file's own contract names that trap by name.
 *
 * So: every function is a value here, exactly as in the React twin, and the two adapters
 * have no behavioural difference left to diverge on. A getter still works, because
 * `composeFontOrigins` calls every function origin once per resolve and a getter ignores
 * the argument it is handed — the re-read the getter form exists for is unaffected. The
 * one shape that changes is a getter returning another ORIGIN (`() => packagedFonts()`),
 * which cannot be told from a resolver by anything; `composeFontOrigins` reports it rather
 * than composing an empty fragment in silence. Wrap that in a `computed` if you need it.
 */
const readOrigin = (origin: MaybeRefOrGetter<FontsInput | FontOrigin>): FontOrigin =>
  (typeof origin === 'function' ? origin : toValue(origin)) as FontOrigin;

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
  const readOrigins = (): readonly FontOrigin[] => reactiveOrigins.map(readOrigin);

  // Marked, so this composition can itself be an origin of another list or
  // `useDocxSource`'s `fonts` option without being read as a zero-argument loader.
  return defineFontResolver((request: FontResolutionRequest) =>
    composeFontOrigins(readOrigins(), request)
  );
}
