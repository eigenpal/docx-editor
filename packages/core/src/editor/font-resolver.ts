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
  FontSource,
  FontSourceSubstitution,
} from '@docx-editor.dev/core/contracts/editor';
import {
  composeFontConfiguration,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type FontResolutionRequest,
  type FontResolver,
} from './font-composition.ts';
import { configuredDefaultFontFamily } from './font-catalog.ts';
import {
  HARD_MAX_AGGREGATE_FONT_BYTES,
  HARD_MAX_FONT_BYTES,
  HARD_MAX_FONT_SOURCES,
  fontByteLength,
  fontRequestKey,
  prepareFontResourceDefinition,
  type FontResourceInstrumentation,
} from '../layout/font-resource.ts';

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

/** One font origin that could not contribute a valid fragment. @public */
export interface FontOriginFailure {
  /** Zero-based position in the first-wins origin list. */
  readonly originIndex: number;
  /** Resolver function name when one is safely available. */
  readonly originName?: string;
  readonly cause: unknown;
}

/** Diagnostics hook for ordered font-origin composition. @public */
export interface ComposeFontOriginsOptions {
  /** Fire-and-forget diagnostics; returned promises are observed but do not delay resolution. */
  readonly onOriginFailure?: (failure: FontOriginFailure) => void;
}

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
  request: FontResolutionRequest,
  options: ComposeFontOriginsOptions = {}
): Promise<FontConfigurationFragment | undefined> {
  return composeFontOriginsInternal(origins, request, options);
}

/** Internal composition whose returned source objects have not escaped Core ownership. @internal */
export async function composePreparedFontOrigins(
  origins: readonly FontOrigin[],
  request: FontResolutionRequest,
  options: ComposePreparedFontOriginsOptions = {}
): Promise<FontConfigurationFragment | undefined> {
  return composeFontOriginsInternal(origins, request, options);
}

/** Internal ownership hook used to reserve process bytes before copying an origin. @internal */
export interface ComposePreparedFontOriginsOptions extends ComposeFontOriginsOptions {
  readonly reserveOwnedBytes?: (byteLength: number) => () => void;
  readonly instrumentation?: Pick<FontResourceInstrumentation, 'onOwnedByteCopy' | 'onHash'>;
}

async function composeFontOriginsInternal(
  origins: readonly FontOrigin[],
  request: FontResolutionRequest,
  options: ComposePreparedFontOriginsOptions
): Promise<FontConfigurationFragment | undefined> {
  // Promise origins may already be running. Observe every one immediately so a rejection behind
  // a slow earlier resolver cannot become an unhandled process-level rejection; results are still
  // consumed and committed strictly in authored order below.
  const observed = origins.map(observePromiseOrigin);
  let base: FontConfiguration | FontConfigurationFragment | undefined;
  const winningSources: FontSource[] = [];
  const sourceFaces = new Map<string, FontFaceRequest>();
  const committedSourceKeys = new Set<string>();
  let committedSourceBytes = 0;
  let substitutions: FontSourceSubstitution[] = [];
  const committedSubstitutionKeys = new Set<string>();
  const inherited = request.resolvedFaces ?? [];
  let defaultFamily = request.defaultFamily;

  for (let originIndex = 0; originIndex < origins.length; originIndex += 1) {
    throwIfFontResolutionAborted(request.signal);
    const origin = origins[originIndex];
    // Faces recomputed per origin rather than accumulated, because a substitution an
    // earlier origin emitted can become paintable when a LATER origin supplies its target.
    const covered = paintableFaces(inherited, sourceFaces, substitutions);
    let sampledAnswer: ReturnType<typeof validateOriginAnswer> | undefined;
    try {
      const observation = observed[originIndex]!;
      let answer: FontConfiguration | FontConfigurationFragment | undefined;
      if (observation) {
        const outcome = await awaitObservedOrigin(observation, request.signal);
        if (!outcome.ok) throw outcome.cause;
        answer = outcome.value;
      } else if (typeof origin === 'function') {
        const outcome = await awaitObservedOrigin(
          Promise.resolve(
            origin({
              ...request,
              defaultFamily,
              ...(covered.length > 0 ? { resolvedFaces: covered } : {}),
            })
          ).then(
            (value) => ({ ok: true as const, value }),
            (cause) => ({ ok: false as const, cause })
          ),
          request.signal
        );
        if (!outcome.ok) throw outcome.cause;
        answer = outcome.value;
      } else {
        answer = origin as FontConfiguration | FontConfigurationFragment | undefined;
      }
      // `== null`, not `=== undefined`: "returning nothing is a valid answer" reads as
      // `null` to plenty of hosts, and reading `.sources` off it took every OTHER origin
      // down with it.
      if (answer == null) continue;
      // An origin can only ever answer a configuration or a fragment. A FUNCTION here is
      // `() => packagedFonts()` where `packagedFonts()` was meant — a shape nothing can
      // tell from a resolver, and one that used to compose as a fragment with no sources
      // and no complaint.
      if (typeof answer === 'function') {
        reportOriginFailure(
          options,
          origin,
          originIndex,
          new TypeError(
            'A font origin answered with a function; pass the resolver itself rather than a function returning one'
          )
        );
        continue;
      }
      // Read the whole answer BEFORE committing any of it. A malformed source — no
      // `request`, an unusable family — throws in `faceKey`, and an origin half-ingested
      // is worse than one skipped: it would sit in `present` with its faces unrecorded and
      // break composition later, outside anyone's catch.
      const sampledOrigin = validateOriginAnswer(
        answer,
        committedSourceKeys,
        committedSourceBytes,
        committedSubstitutionKeys,
        base
          ? 'maxFontBytes' in base && base.maxFontBytes !== undefined
            ? base.maxFontBytes
            : HARD_MAX_FONT_BYTES
          : undefined,
        options.reserveOwnedBytes,
        options.instrumentation
      );
      sampledAnswer = sampledOrigin;
      // A dropped face degraded alone; its siblings still compose below. Report each drop the
      // same way a whole-origin failure is reported, so hosts see exactly what went missing.
      for (const cause of sampledOrigin.dropped) {
        reportOriginFailure(options, origin, originIndex, cause);
      }
      const sampled = sampledOrigin.fragment;
      const faces = (sampled.sources ?? []).map((source) => {
        fontRequestKey(source.request);
        return [faceKey(source.request), source.request] as const;
      });
      const answerSubstitutions = [...(sampled.substitutions ?? [])];
      // The first origin is the composition base, so its configured default face is also the
      // default later on-demand origins must try to cover. Without this, a caller choosing Aptos
      // as the default still made a Google fallback fetch Calibri while leaving Aptos unresolved.
      if (!base && 'defaultFont' in sampled) {
        defaultFamily = configuredDefaultFontFamily(sampled as FontConfigurationBase);
      }
      if (!base) base = sampled;
      const newlyDirect = new Set(sampledOrigin.sourceKeys);
      if (newlyDirect.size > 0) {
        substitutions = substitutions.filter(
          (substitution) => !newlyDirect.has(fontRequestKey(substitution.from))
        );
        for (const key of newlyDirect) committedSubstitutionKeys.delete(key);
      }
      winningSources.push(...(sampled.sources ?? []));
      for (const key of sampledOrigin.sourceKeys) committedSourceKeys.add(key);
      committedSourceBytes += sampledOrigin.ownedBytes;
      for (const [key, face] of faces) sourceFaces.set(key, face);
      for (const substitution of answerSubstitutions) {
        substitutions.push(substitution);
        committedSubstitutionKeys.add(fontRequestKey(substitution.from));
      }
    } catch (cause) {
      // A validated answer that fails after its reservation but before it commits must hand
      // the reserved bytes back, or the lease leaks them for its whole lifetime.
      sampledAnswer?.releaseOwnedBytes?.();
      // Cancellation is a composition boundary, not an origin-local failure. In particular,
      // never start a later network fallback after the document export has already timed out.
      if (request.signal?.aborted) throw request.signal.reason ?? cause;
      if (cause instanceof FontOwnershipReservationError) throw cause.cause;
      // Reported, never swallowed: a font origin that throws is a host bug (an unmarked
      // resolver called as a loader is the common one) and it degrades the document
      // silently otherwise.
      reportOriginFailure(options, origin, originIndex, cause);
      continue;
    }
  }

  if (!base) return undefined;
  const { epoch: _perLoad, ...merged } = composeFontConfiguration({
    ...base,
    sources: winningSources,
    substitutions,
  });
  return merged;
}

type ObservedOriginOutcome =
  | { readonly ok: true; readonly value: FontConfiguration | FontConfigurationFragment | undefined }
  | { readonly ok: false; readonly cause: unknown };

class FontOwnershipReservationError extends Error {
  constructor(readonly cause: unknown) {
    super('Unable to reserve owned font bytes');
    this.name = 'FontOwnershipReservationError';
  }
}

/** Tipping the cumulative source bound is an origin-level refusal, never a face-level drop. */
class FontSourceCountError extends RangeError {}

async function awaitObservedOrigin(
  observation: Promise<ObservedOriginOutcome>,
  signal: AbortSignal | undefined
): Promise<ObservedOriginOutcome> {
  if (!signal) return observation;
  throwIfFontResolutionAborted(signal);
  let rejectAbort: ((cause: unknown) => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const onAbort = (): void => rejectAbort?.(signal.reason);
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([observation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function observePromiseOrigin(origin: FontOrigin): Promise<ObservedOriginOutcome> | undefined {
  if (origin === null || typeof origin !== 'object') return undefined;
  let then: unknown;
  try {
    then = (origin as { readonly then?: unknown }).then;
  } catch (cause) {
    return Promise.resolve({ ok: false, cause });
  }
  if (typeof then !== 'function') return undefined;
  return Promise.resolve(origin).then(
    (value) => ({ ok: true as const, value }),
    (cause) => ({ ok: false as const, cause })
  );
}

function validateOriginAnswer(
  answer: FontConfiguration | FontConfigurationFragment,
  committedSourceKeys: ReadonlySet<string>,
  committedSourceBytes: number,
  committedSubstitutionKeys: ReadonlySet<string>,
  effectiveMaxFontBytes: number | undefined,
  reserveOwnedBytes?: (byteLength: number) => () => void,
  instrumentation?: Pick<FontResourceInstrumentation, 'onOwnedByteCopy' | 'onHash'>
): {
  readonly fragment: FontConfiguration | FontConfigurationFragment;
  readonly sourceKeys: readonly string[];
  readonly ownedBytes: number;
  /** Per-face defects skipped while their siblings composed; reported, never swallowed. */
  readonly dropped: readonly unknown[];
  /** Undoes this answer's owned-byte reservation if the origin fails before it commits. */
  readonly releaseOwnedBytes: (() => void) | undefined;
} {
  const sourceInput = answer.sources ?? [];
  const substitutionInput = answer.substitutions ?? [];
  const configuredMaxInput = 'maxFontBytes' in answer ? answer.maxFontBytes : undefined;
  const defaultFontInput = 'defaultFont' in answer ? answer.defaultFont : undefined;
  const epochInput = 'epoch' in answer ? answer.epoch : undefined;
  const languageInput = 'language' in answer ? answer.language : undefined;
  if (!Array.isArray(sourceInput) || !Array.isArray(substitutionInput)) {
    throw new TypeError('Font origin sources and substitutions must be arrays');
  }
  const sourceCount = sourceInput.length;
  const substitutionCount = substitutionInput.length;
  if (sourceCount > HARD_MAX_FONT_SOURCES) {
    throw new RangeError(`Font source count must not exceed ${HARD_MAX_FONT_SOURCES}`);
  }
  if (substitutionCount > HARD_MAX_FONT_SOURCES) {
    throw new RangeError(`Font substitution count must not exceed ${HARD_MAX_FONT_SOURCES}`);
  }
  const configuredMax = configuredMaxInput ?? HARD_MAX_FONT_BYTES;
  if (
    !Number.isSafeInteger(configuredMax) ||
    configuredMax <= 0 ||
    configuredMax > HARD_MAX_FONT_BYTES
  ) {
    throw new RangeError(
      `Font byte ceiling must be a positive safe integer no greater than ${HARD_MAX_FONT_BYTES}`
    );
  }
  const sourceByteCeiling = effectiveMaxFontBytes ?? configuredMax;
  let aggregateBytes = 0;
  const sourceKeys: string[] = [];
  const candidateKeys = new Set<string>();
  const candidateSources: FontSource[] = [];
  const droppedFaces: unknown[] = [];
  // Face-level defects drop that face and keep its siblings, mirroring the embedded-font
  // budget path: one oversized or malformed face must not discard an origin's other coverage.
  for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex += 1) {
    const sourceInputValue = sourceInput[sourceIndex]!;
    try {
      const request = snapshotFontFaceRequest(sourceInputValue.request);
      const availability = sourceInputValue.availability;
      const faceIndex = sourceInputValue.faceIndex;
      const hash = sourceInputValue.hash;
      const id = sourceInputValue.id;
      const key = fontRequestKey(request);
      if (
        availability !== undefined &&
        availability !== 'available' &&
        availability !== 'forbidden'
      ) {
        throw new TypeError('Font source availability must be available or forbidden');
      }
      if (!Number.isSafeInteger(faceIndex) || faceIndex < 0) {
        throw new RangeError('Font face index must be a non-negative safe integer');
      }
      if (typeof hash !== 'string' || hash.length === 0) {
        throw new TypeError('Font source hash must be a non-empty string');
      }
      let bytes: Uint8Array;
      if (availability !== 'forbidden') {
        if (typeof id !== 'string' || id.length === 0) {
          throw new TypeError('Font source id must be a non-empty string');
        }
        bytes = sourceInputValue.bytes;
        const byteLength = fontByteLength(bytes);
        if (byteLength > sourceByteCeiling) {
          throw new RangeError('Font source exceeds the effective base byte ceiling');
        }
        if (committedSourceKeys.has(key) || candidateKeys.has(key)) continue;
        if (committedSourceBytes + aggregateBytes + byteLength > HARD_MAX_AGGREGATE_FONT_BYTES) {
          throw new RangeError(
            `Font sources exceed the aggregate byte ceiling of ${HARD_MAX_AGGREGATE_FONT_BYTES}`
          );
        }
        aggregateBytes += byteLength;
      } else bytes = new Uint8Array(0);
      if (committedSourceKeys.has(key) || candidateKeys.has(key)) continue;
      if (committedSourceKeys.size + candidateKeys.size >= HARD_MAX_FONT_SOURCES) {
        throw new FontSourceCountError(
          `Font source count must not exceed ${HARD_MAX_FONT_SOURCES}`
        );
      }
      candidateKeys.add(key);
      sourceKeys.push(key);
      candidateSources.push(
        Object.freeze({
          request,
          id,
          bytes,
          hash,
          faceIndex,
          ...(availability ? { availability } : {}),
        })
      );
    } catch (cause) {
      if (cause instanceof FontSourceCountError) throw cause;
      droppedFaces.push(cause);
    }
  }
  const candidateSubstitutionKeys = new Set<string>();
  const substitutions: FontSourceSubstitution[] = [];
  for (let substitutionIndex = 0; substitutionIndex < substitutionCount; substitutionIndex += 1) {
    const substitution = substitutionInput[substitutionIndex]!;
    try {
      const from = snapshotFontFaceRequest(substitution.from);
      const to = snapshotFontFaceRequest(substitution.to);
      fontRequestKey(from);
      fontRequestKey(to);
      const metricsInput = substitution.lineMetrics;
      const metrics = metricsInput
        ? Object.freeze({
            heightEm: metricsInput.heightEm,
            baselineEm: metricsInput.baselineEm,
          })
        : undefined;
      if (
        metrics &&
        (!Number.isFinite(metrics.heightEm) ||
          !Number.isFinite(metrics.baselineEm) ||
          metrics.heightEm <= 0 ||
          metrics.heightEm > 4 ||
          metrics.baselineEm < 0 ||
          metrics.baselineEm > metrics.heightEm)
      ) {
        throw new RangeError('Font substitution line metrics must fit within a bounded em box');
      }
      const key = fontRequestKey(from);
      if (
        committedSourceKeys.has(key) ||
        candidateKeys.has(key) ||
        committedSubstitutionKeys.has(key) ||
        candidateSubstitutionKeys.has(key)
      ) {
        continue;
      }
      candidateSubstitutionKeys.add(key);
      substitutions.push(
        Object.freeze({
          from,
          to,
          ...(metrics ? { lineMetrics: metrics } : {}),
        })
      );
    } catch (cause) {
      droppedFaces.push(cause);
    }
  }
  // An answer whose every face and substitution dropped contributes nothing. Failing it
  // wholesale (with the first drop as the reason) keeps base selection intact: an empty
  // fragment must not become the composition base and poison later origins' byte ceiling.
  if (
    (sourceCount > 0 || substitutionCount > 0) &&
    candidateSources.length === 0 &&
    substitutions.length === 0 &&
    droppedFaces.length > 0
  ) {
    throw droppedFaces[0];
  }
  let retainedCommittedSubstitutions = committedSubstitutionKeys.size;
  for (const key of candidateKeys) {
    if (committedSubstitutionKeys.has(key)) retainedCommittedSubstitutions -= 1;
  }
  if (retainedCommittedSubstitutions + candidateSubstitutionKeys.size > HARD_MAX_FONT_SOURCES) {
    throw new RangeError(`Font substitution count must not exceed ${HARD_MAX_FONT_SOURCES}`);
  }
  let defaultFont: FontConfigurationBase['defaultFont'];
  if (defaultFontInput !== undefined) {
    const family = defaultFontInput.family;
    const sizeHalfPoints = defaultFontInput.sizeHalfPoints;
    fontRequestKey({
      family,
      weight: 400,
      style: 'normal',
    });
    if (!Number.isSafeInteger(sizeHalfPoints) || sizeHalfPoints <= 0) {
      throw new RangeError('Default font size must be a positive safe integer in half-points');
    }
    defaultFont = Object.freeze({
      family,
      sizeHalfPoints,
    });
  }
  if (epochInput !== undefined && (!Number.isSafeInteger(epochInput) || epochInput < 0)) {
    throw new RangeError('Font configuration epoch must be a non-negative safe integer');
  }
  if (languageInput !== undefined && typeof languageInput !== 'string') {
    throw new TypeError('Font shaping language must be a string');
  }
  let releaseReservation: (() => void) | undefined;
  if (aggregateBytes > 0 && reserveOwnedBytes) {
    try {
      releaseReservation = reserveOwnedBytes(aggregateBytes);
    } catch (cause) {
      throw new FontOwnershipReservationError(cause);
    }
  }
  let sources: ReturnType<typeof prepareFontResourceDefinition>[];
  try {
    sources = candidateSources.map((source) =>
      prepareFontResourceDefinition(source, instrumentation)
    );
  } catch (error) {
    releaseReservation?.();
    throw error;
  }
  return {
    fragment: Object.freeze({
      sources: Object.freeze(sources),
      substitutions: Object.freeze(substitutions),
      ...(epochInput !== undefined ? { epoch: epochInput } : {}),
      ...(configuredMaxInput !== undefined ? { maxFontBytes: configuredMaxInput } : {}),
      ...(defaultFont ? { defaultFont } : {}),
      ...(languageInput !== undefined ? { language: languageInput } : {}),
    }) as FontConfiguration | FontConfigurationFragment,
    sourceKeys: Object.freeze(sourceKeys),
    ownedBytes: aggregateBytes,
    dropped: Object.freeze(droppedFaces),
    releaseOwnedBytes: releaseReservation,
  };
}

function snapshotFontFaceRequest(request: FontFaceRequest): FontFaceRequest {
  return Object.freeze({
    family: request.family,
    weight: request.weight,
    style: request.style,
  });
}

function throwIfFontResolutionAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw signal.reason ?? new DOMException('Font resolution was aborted', 'AbortError');
}

function reportOriginFailure(
  options: ComposeFontOriginsOptions,
  origin: FontOrigin,
  originIndex: number,
  cause: unknown
): void {
  let originName: string | undefined;
  try {
    if (typeof origin === 'function' && origin.name.length > 0) originName = origin.name;
  } catch {
    // Hostile function proxies do not get to turn diagnostics into another failure.
  }
  const failure: FontOriginFailure = Object.freeze({
    originIndex,
    ...(originName !== undefined ? { originName } : {}),
    cause,
  });
  if (options.onOriginFailure) {
    try {
      const result = (options.onOriginFailure as (value: FontOriginFailure) => unknown)(failure);
      void Promise.resolve(result).catch((callbackError: unknown) => {
        console.warn('[fonts] font-origin diagnostic callback failed', callbackError);
      });
      return;
    } catch (callbackError) {
      console.warn('[fonts] font-origin diagnostic callback failed', callbackError);
    }
  }
  let diagnostic = '';
  try {
    if (cause instanceof Error && cause.message.length > 0) diagnostic = `: ${cause.message}`;
  } catch {
    // A hostile error proxy cannot make reporting the original origin failure throw.
  }
  console.warn(`[fonts] a font origin failed and was skipped${diagnostic}`, cause);
}
