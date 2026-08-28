// Telling an ON-DEMAND font resolver apart from a zero-argument font LOADER.
//
// Both are functions, and TypeScript cannot separate them: `() => Fragment` is assignable
// to `(request: FontResolutionRequest) => Fragment`, so a union of the two collapses and
// no overload, no `in` check and no arity test can recover which one a host meant. Arity
// especially: `defaultFonts(options = {})` reports `length === 0` and so does a resolver
// written `(_) => …` after minification.
//
// The two must be told apart because they are called differently. A loader is called with
// NO argument and its answer is complete before the document opens — which is what lets
// `useDocxSource` hold the bytes back until fonts settle, so the reader never sees the
// text reflow. A resolver is called by the ENGINE, once per load, with the families that
// document turned out to name; there is nothing to await ahead of the parse, so holding
// the bytes back would wait forever.
//
// So a resolver says so. `defineFontResolver` stamps a well-known symbol on the function
// and `isFontResolver` reads it back. `Symbol.for` rather than a module-local symbol, so
// a resolver built against one copy of these types is still recognized by another — the
// engine is meant to resolve to one copy, but a mis-hoisted adapter must degrade to
// "treated as a loader", not to a silent wrong call.

import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';
import {
  composeFontConfiguration,
  type FontConfigurationFragment,
  type FontResolutionRequest,
  type FontResolver,
} from './font-composition.ts';

/**
 * The marker `defineFontResolver` sets and `isFontResolver` reads.
 *
 * Exported because `@docx-editor.dev/fonts` carries no dependency on the engine — it
 * mirrors the font contract STRUCTURALLY — and still has to mark the resolvers it builds.
 * A package in that position sets `Symbol.for('docx-editor.dev/font-resolver')` itself;
 * this constant is the same symbol, named, for everyone who can import it.
 *
 * @public
 */
export const FONT_RESOLVER_BRAND: unique symbol = Symbol.for(
  'docx-editor.dev/font-resolver'
) as never;

/**
 * Mark a function as an on-demand {@link FontResolver}.
 *
 * Wrap every resolver you hand to `useDocxSource`'s `fonts` option in this. The `fonts`
 * PROP needs no marking — a function there is always a resolver — but the hook also
 * accepts the older zero-argument loader form (`{ fonts: defaultFonts }`), and this is
 * what keeps the two apart.
 *
 * Returns the same function object, mutated, so the mark survives being passed around and
 * a marked resolver stays `===` to itself.
 *
 * ```ts
 * const brandFonts = defineFontResolver(async ({ families }) => ({
 *   sources: await loadMine(families),
 * }));
 * ```
 *
 * @public
 */
export function defineFontResolver<T extends FontResolver>(resolve: T): T {
  Object.defineProperty(resolve, FONT_RESOLVER_BRAND, {
    value: true,
    enumerable: false,
    configurable: true,
  });
  return resolve;
}

/**
 * Whether a value is a function marked by {@link defineFontResolver}.
 *
 * False for an unmarked function, which is read as a zero-argument loader. That is the
 * safe direction to be wrong in: a loader called with no argument returns something
 * usable, while a resolver called with no argument reads `request.defaultFamily` off
 * `undefined` and throws.
 *
 * @public
 */
export function isFontResolver(value: unknown): value is FontResolver {
  return (
    typeof value === 'function' &&
    (value as Partial<Record<typeof FONT_RESOLVER_BRAND, unknown>>)[FONT_RESOLVER_BRAND] === true
  );
}

/**
 * ONE font origin, in the one shape every origin takes: a finished configuration, a
 * fragment, a promise for either, or a {@link FontResolver} that answers per document.
 *
 * The point of the union is that `packagedFonts()`, `googleFonts()`, `await defaultFonts()`
 * and a hand-built `{ sources }` are all the same kind of thing, so a list of them needs no
 * ordering rule beyond "first wins".
 *
 * @public
 */
export type FontOrigin =
  | FontConfiguration
  | FontConfigurationFragment
  | FontResolver
  | Promise<FontConfiguration | FontConfigurationFragment | undefined>
  | undefined;

/**
 * Resolve a list of {@link FontOrigin}s against one document's needs and merge them,
 * first-wins in list order.
 *
 * Origins resolve IN ORDER, and each is told what the ones before it already answered for
 * ({@link FontResolutionRequest.resolvedFamilies}). That is the whole reason this is not a
 * `Promise.all`: composition is first-wins, so a later origin's copy of a face an earlier
 * one supplied can never be used, and fetching it anyway costs the bytes twice and tells a
 * font host which families the document uses for a result that gets thrown away. The
 * common composition — `[packagedFonts(), googleFonts()]` — is exactly this case: the
 * bundled faces answer first from disk, and the catalog is only asked about the rest.
 *
 * Ordering origins cheapest-first is therefore worth doing. A resolver that ignores
 * `resolvedFamilies` still composes correctly; it just spends more.
 *
 * The result carries NO `epoch`: it is a fragment for the engine to stamp with the load
 * sequence. A fixed epoch from here would label every document's byte set as the same one.
 * `undefined` means no origin contributed anything, which is a normal answer — the document
 * stays on the fixed measurer.
 *
 * @public
 */
export async function composeFontOrigins(
  origins: readonly FontOrigin[],
  request: FontResolutionRequest
): Promise<FontConfigurationFragment | undefined> {
  const present: (FontConfiguration | FontConfigurationFragment)[] = [];
  // Both halves of "covered": the names the DOCUMENT wrote (a substitution's `from`) and
  // the faces actually loaded for them (a source's family). A later origin asked about
  // either would answer with bytes composition is bound to drop.
  const covered = new Set<string>();
  for (const origin of origins) {
    const answer =
      typeof origin === 'function'
        ? await origin(
            covered.size === 0 ? request : { ...request, resolvedFamilies: [...covered] }
          )
        : await origin;
    if (answer === undefined) continue;
    present.push(answer);
    for (const source of answer.sources ?? []) covered.add(source.request.family);
    for (const substitution of answer.substitutions ?? []) covered.add(substitution.from.family);
  }
  if (present.length === 0) return undefined;
  const { epoch: _perLoad, ...merged } = composeFontConfiguration(present[0]!, ...present.slice(1));
  return merged;
}
