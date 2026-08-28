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
  composeFontOrigins,
  defineFontResolver,
  type FontOrigin,
  type FontResolutionRequest,
  type MarkedFontResolver,
} from '@docx-editor.dev/core/editor';

/**
 * Anything that can describe fonts: a resolved configuration, a bare fragment, a promise
 * for either (what a loader like `defaultFonts()` returns), or an on-demand
 * {@link FontResolver} (what `packagedFonts()` and `googleFonts()` return).
 *
 * @public
 */
export type FontsInput = FontOrigin;

/**
 * Merge font origins into one stable value for `DocxEditor.Root`'s `fonts` prop.
 *
 * ```tsx
 * // The bundled substitutes, loaded only for the families this document names.
 * const fonts = useFonts(packagedFonts());
 *
 * // The same, plus the Google catalog for everything they do not cover.
 * const fonts = useFonts(packagedFonts(), googleFonts());
 *
 * // Brand faces first, then whatever is left.
 * const fonts = useFonts(brandFragment, packagedFonts());
 *
 * return <DocxEditor.Root fonts={fonts}>{children}</DocxEditor.Root>;
 * ```
 *
 * EVERY argument takes the same union, so adding an origin is adding an argument and
 * never a change of shape. Origins compose first-wins in argument order, exactly like
 * `composeFontConfiguration`: the first argument beats later ones, and any of them beats
 * a substitution for a family some origin supplies directly.
 *
 * They resolve ONE AFTER ANOTHER, not concurrently, so that each can be told which faces
 * the ones before it already cover and skip fetching them. That costs one extra origin's
 * latency on the critical path and saves a duplicate download — and, for a network origin,
 * a request that would have told a font host which families the document uses for nothing.
 * Order origins cheapest-first.
 *
 * The returned resolver never changes identity, so the editor is never rebuilt on account
 * of this prop — which also means the arguments are re-read per LOAD rather than per
 * render. Changing them mid-document does not re-resolve fonts; load a document, or
 * remount, for new fonts to take effect.
 *
 * It is marked (`defineFontResolver`), so it can itself be an origin of another list or
 * `useDocxSource`'s `fonts` option without being mistaken for a zero-argument loader.
 *
 * @public
 */
export function useFonts(...origins: readonly FontsInput[]): MarkedFontResolver {
  // Read at resolve time, not captured: the resolver below outlives every render.
  const latest = useRef<readonly FontsInput[]>(origins);
  latest.current = origins;

  return useMemo<MarkedFontResolver>(
    () =>
      defineFontResolver((request: FontResolutionRequest) =>
        composeFontOrigins(latest.current, request)
      ),
    []
  );
}
