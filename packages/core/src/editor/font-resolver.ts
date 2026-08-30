// Telling an ON-DEMAND font resolver apart from a zero-argument font LOADER.
//
// Both are functions, and structurally TypeScript cannot separate them: `() => Fragment`
// is assignable to `(request: FontResolutionRequest) => Fragment`, so a union of the two
// collapses and no `in` check and no arity test can recover which one a host meant. Arity
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
// So a resolver says so, TWICE, and the two spellings do different jobs:
//
//   `FONT_RESOLVER_BRAND`, a `Symbol.for` — the RUNTIME mark `isFontResolver` reads. A
//   registered symbol rather than a module-local one, so a resolver built against one copy
//   of these types is still recognized by another.
//
//   `FontResolverMark`, an interface with a namespaced string key — the TYPE-LEVEL mark,
//   which is what makes handing an unmarked resolver to a `FontOrigin` list a compile
//   error instead of a silent total loss of fonts. It has to be a string key, because
//   `@docx-editor.dev/fonts` mirrors this contract STRUCTURALLY and cannot import from the
//   engine: two `unique symbol` declarations in two packages are two different types,
//   while two identical string keys are one.
//
// Both are set on the function, so the type's claim is one the runtime backs up. Only the
// SYMBOL is authoritative: `isFontResolver` reads that and nothing else, so a value that
// spells the string key by hand satisfies the type and still answers `false`. That is the
// safe direction — such a value has to be built deliberately, and it fails loudly at the
// first call rather than quietly resolving to the wrong thing.
//
// The mark lives on the function OBJECT, so it does not survive `.bind()` or being wrapped
// in another function. Re-mark the result of either.

import type {
  FontConfiguration,
  FontFaceRequest,
  FontSourceSubstitution,
} from '@docx-editor.dev/core/contracts/editor';
import {
  composeFontConfiguration,
  type FontConfigurationFragment,
  type FontResolutionRequest,
  type FontResolver,
} from './font-composition.ts';

/**
 * The namespaced key carrying the type-level half of the mark, and the runtime property
 * name that backs it.
 *
 * A plain string rather than a symbol on purpose: `@docx-editor.dev/fonts` has no runtime
 * or type dependency on the engine, so it declares the same mark itself, and two
 * `unique symbol`s in two packages would not unify. Two identical string keys do.
 *
 * @public
 */
export const FONT_RESOLVER_MARK_KEY = 'docx-editor.dev/font-resolver';

/**
 * The runtime marker `defineFontResolver` sets and {@link isFontResolver} reads.
 *
 * Exported because a package mirroring the font contract structurally still has to mark
 * the resolvers it builds. A package in that position sets
 * `Symbol.for('docx-editor.dev/font-resolver')` itself; this constant is the same symbol,
 * named, for everyone who can import it.
 *
 * @public
 */
export const FONT_RESOLVER_BRAND: unique symbol = Symbol.for(
  'docx-editor.dev/font-resolver'
) as never;

/**
 * The type-level half of the mark: what {@link defineFontResolver} adds to a function's
 * type so a `FontOrigin` list can REQUIRE it.
 *
 * Declared with a string key so `@docx-editor.dev/fonts` can declare an identical
 * interface and have the two unify without importing anything from the engine. Set at
 * runtime as well as in the type — non-enumerable, so it stays out of `Object.keys` and
 * out of a host's own spread.
 *
 * @public
 */
export interface FontResolverMark {
  /** Always `true`. Set non-enumerably by {@link defineFontResolver}. */
  readonly 'docx-editor.dev/font-resolver': true;
}

/**
 * A {@link FontResolver} that has been through {@link defineFontResolver}.
 *
 * This, not bare `FontResolver`, is what a `FontOrigin` list accepts. The mark is the only
 * thing separating a resolver from a zero-argument loader, and getting that wrong loses
 * every font silently, so the type asks for it up front.
 *
 * @public
 */
export type MarkedFontResolver<T extends FontResolver = FontResolver> = T & FontResolverMark;

/**
 * Mark a function as an on-demand {@link FontResolver}.
 *
 * Wrap every resolver you put in a `fonts` list — `useFonts(...)`, `useDocxSource`'s
 * `fonts` option, `composeFontOrigins`. The `fonts` PROP needs no marking, because a
 * function there is always a resolver; a list also accepts the older zero-argument loader
 * form (`{ fonts: defaultFonts }`), and this is what keeps the two apart.
 *
 * Returns the same function object, mutated, so the mark survives being passed around and
 * a marked resolver stays `===` to itself. It does NOT survive `.bind()` or being wrapped:
 * both make a new function object. Re-mark the result.
 *
 * ```ts
 * const brandFonts = defineFontResolver(async ({ families }) => ({
 *   sources: await loadMine(families),
 * }));
 * ```
 *
 * Throws a `TypeError` on a frozen or sealed function, which cannot take the mark. That is
 * deliberate: returning it unmarked would compile — the return TYPE says marked — and then
 * lose every font at runtime.
 *
 * @public
 */
export function defineFontResolver<T extends FontResolver>(resolve: T): MarkedFontResolver<T> {
  const descriptor = { value: true, enumerable: false, configurable: true } as const;
  try {
    Object.defineProperty(resolve, FONT_RESOLVER_BRAND, descriptor);
    Object.defineProperty(resolve, FONT_RESOLVER_MARK_KEY, descriptor);
  } catch (cause) {
    throw new TypeError(
      'defineFontResolver cannot mark a frozen or sealed function; mark it before freezing, ' +
        'or wrap it in a fresh function and mark that.',
      { cause }
    );
  }
  return resolve as MarkedFontResolver<T>;
}

/**
 * Whether a value is a function marked by {@link defineFontResolver}.
 *
 * False for an unmarked function, which callers read as a zero-argument loader. Calling a
 * resolver that way reads `request.defaultFamily` off `undefined` and throws, so the
 * callers that make this choice say so rather than swallowing it — and the type-level mark
 * on {@link MarkedFontResolver} is there to stop it reaching runtime at all.
 *
 * @public
 */
export function isFontResolver(value: unknown): value is MarkedFontResolver {
  return (
    typeof value === 'function' &&
    (value as Partial<Record<typeof FONT_RESOLVER_BRAND, unknown>>)[FONT_RESOLVER_BRAND] === true
  );
}

/**
 * ONE font origin, in the one shape every origin takes: a finished configuration, a
 * fragment, a promise for either, or a marked resolver that answers per document.
 *
 * The point of the union is that `packagedFonts()`, `googleFonts()`, `await defaultFonts()`
 * and a hand-built `{ sources }` are all the same kind of thing, so a list of them needs no
 * ordering rule beyond "first wins".
 *
 * The resolver arm is {@link MarkedFontResolver}, not bare `FontResolver`: a list may also
 * hold a zero-argument loader, and only the mark separates the two.
 *
 * @public
 */
export type FontOrigin =
  | FontConfiguration
  | FontConfigurationFragment
  | MarkedFontResolver
  | Promise<FontConfiguration | FontConfigurationFragment | undefined>
  | undefined;

/**
 * Face identity for coverage bookkeeping: family (case-folded, as Word matches names),
 * weight and style.
 *
 * Its own function rather than `fontRequestKey`, which asserts its argument and throws on
 * a family a document could easily contain. Nothing here should be able to fail a
 * composition over a hostile font name.
 */
const faceKey = (face: FontFaceRequest): string =>
  `${face.family.trim().toLowerCase()} ${face.weight} ${face.style}`;

/**
 * The faces the composition so far can actually PAINT, which is the only thing a later
 * origin may safely skip.
 *
 * Two rules, and both were bugs before they were rules:
 *
 * - Keyed on family AND weight AND style. Keyed on family alone, an earlier origin holding
 *   only regular Arial marked "Arial" covered and suppressed the bold, italic and
 *   bold-italic a later origin would have supplied — faces that then had neither bytes nor
 *   a substitution.
 * - BYTES ONLY. A substitution counts only when the face it points AT has bytes. Both
 *   shipped resolvers emit their substitution map before fetching anything, so a
 *   `packagedFonts()` whose assets 503 still reports Calibri→Carlito for four faces it did
 *   not load; trusting that suppressed the `googleFonts()` failover the host put in the
 *   list for exactly this case.
 *
 * With both rules, skipping a reported face genuinely cannot lose one, which is what lets
 * `resolvedFaces` be documented as an optimization a resolver may ignore.
 */
function paintableFaces(
  inherited: readonly FontFaceRequest[],
  sourceFaces: ReadonlyMap<string, FontFaceRequest>,
  substitutions: readonly FontSourceSubstitution[]
): FontFaceRequest[] {
  // Seeded with whatever the CALLER was already told, so a composition used as an origin
  // of another composition — which is exactly what a `useFonts` result handed to another
  // list is — passes its coverage through instead of dropping it.
  const faces = new Map(inherited.map((face) => [faceKey(face), face] as const));
  for (const [key, face] of sourceFaces) faces.set(key, face);
  for (const substitution of substitutions) {
    // `faces`, not `sourceFaces`: it holds every source face plus the inherited ones, and
    // an inherited face is paintable by definition. Testing `sourceFaces` as well was dead
    // — `faces` was seeded from it two lines up.
    if (faces.has(faceKey(substitution.to))) {
      faces.set(faceKey(substitution.from), substitution.from);
    }
  }
  return [...faces.values()];
}

/**
 * Resolve a list of {@link FontOrigin}s against one document's needs and merge them,
 * first-wins in list order.
 *
 * Origins resolve IN ORDER, one after another, and each is told which faces the ones
 * before it can already paint ({@link FontResolutionRequest.resolvedFaces}). Sequential
 * rather than a `Promise.all`, and that is a real cost — one extra origin's latency on the
 * critical path — bought deliberately: composition is first-wins, so a later origin's copy
 * of a face an earlier one supplied can never be used, and fetching it anyway spends the
 * bytes twice and tells a font host which families the document uses for a result that
 * gets thrown away. Order origins cheapest-first.
 *
 * A resolver that ignores `resolvedFaces` still composes correctly; it just spends more.
 *
 * ONE ORIGIN CANNOT SINK THE REST. An origin that throws, answers `null`, or answers
 * something malformed is reported and skipped whole, and the origins around it still
 * compose — an app that listed a flaky network origin behind a bundled one keeps the
 * bundled faces. Skipped WHOLE: an answer is read completely before any of it is
 * committed, so a half-ingested origin can never reach composition.
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
  const sourceFaces = new Map<string, FontFaceRequest>();
  const substitutions: FontSourceSubstitution[] = [];
  const inherited = request.resolvedFaces ?? [];

  for (const origin of origins) {
    // Faces recomputed per origin rather than accumulated, because a substitution an
    // earlier origin emitted can become paintable when a LATER origin supplies its target.
    const covered = paintableFaces(inherited, sourceFaces, substitutions);
    try {
      const answer =
        typeof origin === 'function'
          ? await origin(covered.length === 0 ? request : { ...request, resolvedFaces: covered })
          : await origin;
      // `== null`, not `=== undefined`: "returning nothing is a valid answer" reads as
      // `null` to plenty of hosts, and reading `.sources` off it took every OTHER origin
      // down with it.
      if (answer == null) continue;
      // An origin can only ever answer a configuration or a fragment. A FUNCTION here is
      // `() => packagedFonts()` where `packagedFonts()` was meant — a shape nothing can
      // tell from a resolver, and one that used to compose as a fragment with no sources
      // and no complaint.
      if (typeof answer === 'function') {
        console.warn(
          '[fonts] a font origin answered with a function and was skipped; pass the ' +
            'resolver itself rather than a function returning one'
        );
        continue;
      }
      // Read the whole answer BEFORE committing any of it. A malformed source — no
      // `request`, an unusable family — throws in `faceKey`, and an origin half-ingested
      // is worse than one skipped: it would sit in `present` with its faces unrecorded and
      // break composition later, outside anyone's catch.
      const faces = (answer.sources ?? []).map(
        (source) => [faceKey(source.request), source.request] as const
      );
      const answerSubstitutions = [...(answer.substitutions ?? [])];
      present.push(answer);
      for (const [key, face] of faces) sourceFaces.set(key, face);
      for (const substitution of answerSubstitutions) substitutions.push(substitution);
    } catch (cause) {
      // Reported, never swallowed: a font origin that throws is a host bug (an unmarked
      // resolver called as a loader is the common one) and it degrades the document
      // silently otherwise.
      console.warn('[fonts] a font origin failed and was skipped', cause);
      continue;
    }
  }

  if (present.length === 0) return undefined;
  const { epoch: _perLoad, ...merged } = composeFontConfiguration(present[0]!, ...present.slice(1));
  return merged;
}
