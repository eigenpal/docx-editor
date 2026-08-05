// The stable-identity wrapper every font source needs before it can be a prop.
//
// `DocxEditor.Root` rebuilds its instance when `fonts` changes identity, which is right
// for a value — new bytes are a new document setup — and a trap for a function:
// `fonts={googleFonts()}` is a fresh resolver on every render, so the editor would be
// destroyed and rebuilt on every render, forever. Awaiting a loader in the component has
// the same shape of problem from the other end (`useState` + an effect, cancelled on
// unmount, and nothing renders until it lands).
//
// `useFonts` gives back ONE resolver for the component's life, delegating to whatever was
// passed most recently. Inline objects, inline `googleFonts()`, a promise, a bare
// fragment: all fine, none of them remount anything.

import { useMemo, useRef } from 'react';
import {
  composeFontConfiguration,
  type FontConfigurationFragment,
  type FontResolutionRequest,
  type FontResolver,
} from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';

/**
 * Anything that can describe fonts: a resolved configuration, a bare fragment, a promise
 * for either (what a loader like `defaultFonts()` returns), or an on-demand
 * {@link FontResolver}.
 *
 * @public
 */
export type FontsInput =
  | FontConfiguration
  | FontConfigurationFragment
  | FontResolver
  | Promise<FontConfiguration | FontConfigurationFragment | undefined>
  | undefined;

/**
 * Merge font origins into one stable value for `DocxEditor.Root`'s `fonts` prop.
 *
 * ```tsx
 * // On demand: only the families this document names are fetched.
 * const fonts = useFonts(googleFonts());
 *
 * // On demand, plus brand faces you always want.
 * const fonts = useFonts(googleFonts(), brandFragment);
 *
 * // Eager, from the bundled substitutes.
 * const fonts = useFonts(defaultFonts());
 *
 * return <DocxEditor.Root fonts={fonts}>{children}</DocxEditor.Root>;
 * ```
 *
 * Origins compose first-wins in argument order, exactly like `composeFontConfiguration`:
 * the first argument beats later ones, and any of them beats a substitution for a family
 * some origin supplies directly.
 *
 * The returned resolver never changes identity, so the editor is never rebuilt on account
 * of this prop — which also means the arguments are re-read per LOAD rather than per
 * render. Changing them mid-document does not re-resolve fonts; load a document, or
 * remount, for new fonts to take effect.
 *
 * @public
 */
export function useFonts(
  source: FontsInput,
  ...fragments: readonly (FontConfigurationFragment | undefined)[]
): FontResolver {
  // Read at resolve time, not captured: the resolver below outlives every render.
  const latest = useRef<{
    source: FontsInput;
    fragments: readonly (FontConfigurationFragment | undefined)[];
  }>({ source, fragments });
  latest.current = { source, fragments };

  return useMemo<FontResolver>(
    () => async (request: FontResolutionRequest) => {
      const current = latest.current;
      const resolved =
        typeof current.source === 'function' ? await current.source(request) : await current.source;
      const origins = [resolved, ...current.fragments].filter(
        (origin): origin is FontConfiguration | FontConfigurationFragment => origin !== undefined
      );
      if (origins.length === 0) return undefined;
      // Composed WITHOUT an epoch: the engine stamps the load sequence onto whatever a
      // resolver returns, and a fixed epoch from here would label every document's byte
      // set as the same one.
      const { epoch: _perLoad, ...merged } = composeFontConfiguration(
        origins[0]!,
        ...origins.slice(1)
      );
      return merged;
    },
    []
  );
}
