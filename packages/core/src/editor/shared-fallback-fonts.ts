// The editor's use of the shared font fallback rules (`layout/font-fallback-rules.ts`).
//
// An exporter reads the fallback faces from disk. The editor has no disk: it reads them from
// the host's own font configuration, under the family names of the faces. A host that serves
// those names (the fonts package does) gets the same substitutions in the editor as in an
// export of the same document, so both lay the text out in one face.
//
// A family that the platform has installed keeps its own face, as before: the rules apply only
// to a family that is missing.
//
// The rules are the engine's font substitution for a font that `w:rFonts` names and the host
// cannot locate (`CT_Fonts`, ECMA-376 Part 1, 17.3.2.26, and font substitution, 17.8.2).

import type { FontConfiguration, FontSource, FontSourceSubstitution } from '../contracts/editor.ts';
import type { EmbeddedFont } from '@docx-editor.dev/core/store';
import { embeddedFontSourcesAfterExplicit } from './embedded-font-sources.ts';
import { disposeLayoutShaping } from './font-configuration.ts';
import type { FontFaceRequest } from '../contracts/editor-fonts.ts';
import {
  namedFallbackFontResolver,
  standInFontResolver,
  type FallbackFaceReader,
} from '../layout/font-fallback-resolvers.ts';
import {
  MAX_RESOLVER_FAMILIES,
  composeFontConfiguration,
  normalizeFontResolverResult,
  type FontConfigurationBase,
  type FontConfigurationFragment,
  type FontResolutionRequest,
} from '../layout/font-composition.ts';
import {
  GLYPH_FALLBACK_FACES,
  GLYPH_FALLBACK_FAMILIES,
  glyphFallbackFamiliesFor,
  hasMetricCompatibleSubstitute,
} from '../layout/font-fallback-rules.ts';
import { withGlyphFallbackAliases } from '../layout/glyph-fallback-aliases.ts';
import { withGlyphFallbacks } from '../layout/glyph-fallback-shaper.ts';
import type { LayoutShapingOptions } from '../layout/shaped-measurer.ts';
import { splitDeferredAnswer } from '../layout/font-deferred.ts';
import { FontResolutionError, fontRequestKey } from '../layout/font-resource.ts';
import { paintableFaces } from '../layout/font-resolver.ts';

/** The host's font configuration: bytes it holds, or a resolver it answers with. */
export type FallbackFaceHost =
  FontConfigurationFragment | ((request: FontResolutionRequest) => unknown) | undefined;

/** The fallback faces of one document load and font configuration. */
export interface FallbackFaceCache {
  /** The faces read so far, by face. */
  readonly sources: Map<string, FontSource>;
  /**
   * What the host was asked for: a family (every face), or one face of it. A host that has no
   * such face is not asked again in the same load.
   */
  readonly asked: Set<string>;
  /**
   * Every family that the rules were asked about in this load, by case-folded name. A later
   * request can name fewer families than the first; a family from before keeps its fallback.
   */
  readonly families: Map<string, string>;
}

/** The cache of the current load: a new key drops the faces of the load before it. */
export function createFallbackFaceCaches(): { of(key: string): FallbackFaceCache } {
  let current: { readonly key: string; readonly cache: FallbackFaceCache } | undefined;
  return {
    of(key) {
      if (current?.key !== key)
        current = { key, cache: { sources: new Map(), asked: new Set(), families: new Map() } };
      return current.cache;
    },
  };
}

const fold = (family: string): string => family.trim().toLowerCase();

const safeKey = (face: FontFaceRequest): string | undefined => {
  try {
    return fontRequestKey(face);
  } catch {
    return undefined; // a family name the engine refuses names no face
  }
};

const faceId = (face: FontFaceRequest): string =>
  `${fold(face.family)} ${face.weight} ${face.style}`;

/** What one pass of the fallback rules wants to read: families, and faces when it states them. */
interface FallbackFaceDemand {
  readonly families: Map<string, string>;
  /** Undefined when a rule asked for every face. */
  faces: Map<string, FontFaceRequest> | undefined;
}

/** A reader that reads nothing and records what the rules ask for. */
function recordingReader(demand: FallbackFaceDemand): FallbackFaceReader {
  return (families, _signal, faces) => {
    for (const family of families) demand.families.set(fold(family), family);
    if (!faces) demand.faces = undefined;
    else for (const face of faces) demand.faces?.set(faceId(face), face);
    return Promise.resolve([]);
  };
}

/** A reader over the faces that `cache` holds. It asks the host for nothing. */
function cachedReader(cache: FallbackFaceCache): FallbackFaceReader {
  return (families) => {
    const wanted = new Set([...families].map(fold));
    return Promise.resolve(
      [...cache.sources.values()].filter((source) => wanted.has(fold(source.request.family)))
    );
  };
}

/**
 * Read the faces of `demand` from the host into `cache`, in one request. A resolver host is
 * asked for the families by name; a host that holds bytes is searched. A family or face the
 * host was asked for before in this load is not asked for again.
 */
async function readFallbackFaces(
  host: FallbackFaceHost,
  cache: FallbackFaceCache,
  demand: FallbackFaceDemand,
  request: Pick<FontResolutionRequest, 'defaultFamily' | 'signal'>
): Promise<void> {
  if (!host || demand.families.size === 0) return;
  const store = (answer: FontConfigurationFragment | undefined): void => {
    for (const source of answer?.sources ?? []) {
      if (!demand.families.has(fold(source.request.family))) continue;
      const key = safeKey(source.request);
      if (key && !cache.sources.has(key)) cache.sources.set(key, source);
    }
  };
  if (typeof host !== 'function') return store(host);
  const faces = demand.faces && [...demand.faces.values()];
  const families: string[] = [];
  /** What this request asks for the first time: a family, or the faces of one. */
  const asking = new Set<string>();
  for (const [key, family] of demand.families) {
    if (cache.asked.has(key)) continue;
    const news = (
      faces ? faces.filter((face) => fold(face.family) === key).map(faceId) : [key]
    ).filter((one) => !cache.asked.has(one));
    if (news.length === 0) continue;
    families.push(family);
    for (const one of news) asking.add(one);
  }
  if (families.length === 0) return;
  for (const one of asking) cache.asked.add(one);
  let raw: unknown;
  try {
    raw = await host({
      families,
      defaultFamily: request.defaultFamily,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(faces ? { faces: faces.filter((face) => asking.has(faceId(face))) } : {}),
      ...(cache.sources.size > 0
        ? { resolvedFaces: [...cache.sources.values()].map((one) => one.request) }
        : {}),
    });
  } catch (error) {
    // A host that fails for the fallback faces keeps the answer it gave for the document's
    // own families. The faces stay asked for: a failing host is not asked again in this load.
    if (request.signal?.aborted) throw error;
    return;
  }
  store(
    normalizeFontResolverResult(
      splitDeferredAnswer(raw as Parameters<typeof splitDeferredAnswer>[0]).now
    )
  );
}

/** What the shared rules add to the host's answer. */
export interface SharedFallbackFonts {
  /** The named fallback faces and their substitutions. Compose after the host's answer. */
  readonly named: FontConfigurationFragment;
  /** The stand-ins of the families nothing covers. Compose after the document's own faces. */
  readonly standIns: FontConfigurationFragment;
  /**
   * The families (case-folded) that render in a fallback face with other metrics. The
   * compatibility notice reports them.
   */
  readonly substituted: ReadonlySet<string>;
}

const EMPTY: SharedFallbackFonts = Object.freeze({
  named: Object.freeze({}),
  standIns: Object.freeze({}),
  substituted: new Set<string>(),
});

const facesOf = (
  sources: readonly FontSource[],
  substitutions: readonly FontSourceSubstitution[]
): FontFaceRequest[] => {
  const byKey = new Map<string, FontFaceRequest>();
  for (const source of sources) {
    const key = safeKey(source.request);
    if (key)
      byKey.set(
        `${fold(source.request.family)} ${source.request.weight} ${source.request.style}`,
        source.request
      );
  }
  return paintableFaces([], byKey, substitutions);
};

/**
 * Apply the shared fallback rules to the families that the host's answer and the document's
 * embedded faces leave without a face. The fallback faces come from `host`, in at most one
 * request: the rules first state what they need, then run over what the host answered.
 *
 * `installed` tells the families that the platform draws itself. They keep their own face.
 */
export async function resolveSharedFallbackFonts(input: {
  readonly explicit: FontConfigurationBase | undefined;
  readonly embedded: readonly FontSource[];
  readonly request: FontResolutionRequest;
  readonly host: FallbackFaceHost;
  readonly cache: FallbackFaceCache;
  readonly installed: (family: string) => boolean;
}): Promise<SharedFallbackFonts> {
  const { explicit, embedded, host, cache, installed } = input;
  if (!explicit) return EMPTY;
  for (const family of input.request.families)
    if (!cache.families.has(fold(family))) cache.families.set(fold(family), family);
  const request = { ...input.request, families: [...cache.families.values()] };
  const hostSources = explicit.sources ?? [];
  const hostSubstitutions = explicit.substitutions ?? [];
  const hostFaces = facesOf(hostSources, hostSubstitutions);
  const hostFamilies = new Set(hostFaces.map((face) => fold(face.family)));
  // A family the host answers for, or the platform has, is not missing.
  const missing = request.families.filter(
    (family) => !hostFamilies.has(fold(family)) && !installed(family)
  );
  if (missing.length === 0) return EMPTY;
  const kept = new Set(missing.map(fold));
  const scoped: FontResolutionRequest = {
    ...request,
    families: missing,
    ...(request.faces
      ? { faces: request.faces.filter((face) => kept.has(fold(face.family))) }
      : {}),
  };
  const run = async (read: FallbackFaceReader) => {
    const named = await namedFallbackFontResolver(read)({ ...scoped, resolvedFaces: hostFaces });
    const standIns = await standInFontResolver(read)({
      ...scoped,
      resolvedFaces: facesOf(
        [...hostSources, ...named.sources, ...embedded],
        [...hostSubstitutions, ...named.substitutions]
      ),
    });
    return { named, standIns };
  };
  const demand: FallbackFaceDemand = { families: new Map(), faces: new Map() };
  await run(recordingReader(demand));
  // The host answered for the missing families already: it has no face of them.
  for (const family of kept) demand.families.delete(family);
  await readFallbackFaces(host, cache, demand, request);
  const { named, standIns } = await run(cachedReader(cache));
  const substituted = new Set<string>();
  for (const { from, to } of [...named.substitutions, ...standIns.substitutions]) {
    // A metric-compatible substitute keeps the line breaks: nothing to report.
    if (fold(from.family) !== fold(to.family) && !hasMetricCompatibleSubstitute(from.family))
      substituted.add(fold(from.family));
  }
  return { named, standIns, substituted };
}

/** The host's answer with the named fallback faces behind it. */
export function withNamedFallbackFonts(
  explicit: FontConfigurationBase | undefined,
  named: FontConfigurationFragment
): FontConfigurationBase | undefined {
  if (!explicit || (!named.sources?.length && !named.substitutions?.length)) return explicit;
  return {
    ...explicit,
    sources: [...(explicit.sources ?? []), ...(named.sources ?? [])],
    substitutions: [...(explicit.substitutions ?? []), ...(named.substitutions ?? [])],
  };
}

/** The shaping that each glyph fallback shaping wraps: the one that owns the native shaper. */
const wrappedShapings = new WeakMap<LayoutShapingOptions, LayoutShapingOptions>();

/** Release the native shaper of `shaping`, which {@link GlyphFallbackDemand.shaping} built. */
export function disposeFallbackShaping(shaping: LayoutShapingOptions): void {
  disposeLayoutShaping(wrappedShapings.get(shaping) ?? shaping);
}

/** What the editor keeps about the glyph fallback faces of one document load. */
export interface GlyphFallbackDemand {
  /** The families asked for so far, in fallback order. */
  families(): readonly string[];
  /** Whether `family` is a glyph fallback family asked for: it bypasses the installed check. */
  has(family: string): boolean;
  /**
   * Whether the demand grew by a face that the installed fonts already hold, so the fonts
   * must install again even when the host has nothing new to answer.
   */
  pending(): boolean;
  /** Forget every family: a new document starts with none. */
  reset(): void;
  /**
   * Shaping with the glyph fallback chain over the faces that `shaping` holds. A character
   * that no held face covers asks for the next faces of the chain, through `request`.
   *
   * `cssSmallCaps` tells that a browser draws small caps, through CSS: the measurer then
   * follows the browser for a face without the feature. With no browser to follow, the shaper
   * synthesizes them, as an export does.
   *
   * `complete` tells that the fonts cannot grow: the host gave a fixed set of faces. Nothing
   * loads later, so the chain holds every fallback family from the first layout, and an
   * uncovered character asks for nothing. The document lays out once.
   */
  shaping(
    shaping: LayoutShapingOptions,
    cssSmallCaps: boolean,
    complete?: boolean
  ): LayoutShapingOptions;
}

/**
 * The editor's glyph fallback chain. An exporter holds every fallback face; the editor asks
 * its host for them in steps, when a character needs one, so a document whose faces cover
 * its text loads none.
 *
 * The chain holds only the families that were asked for, never a family that the fonts hold
 * for another reason. A document in Times New Roman holds that face, which is also a fallback
 * face behind the symbol faces: used before they load, it would draw a symbol that they draw
 * in an export. A chain of the asked families is always the start of the exporter's chain.
 *
 * `request` runs when the demand grows. `held` tells that the installed fonts already hold
 * one of the new faces, so a host that answers nothing new must still install again.
 */
export function createGlyphFallbackDemand(request: (held: boolean) => void): GlyphFallbackDemand {
  const wanted = new Set<string>();
  const has = (family: string): boolean => wanted.has(fold(family));
  let pending = false;
  return {
    families: () => GLYPH_FALLBACK_FAMILIES.filter(has),
    has,
    pending: () => pending,
    reset: () => (wanted.clear(), void (pending = false)),
    shaping(shaping, cssSmallCaps, complete = false) {
      pending = false;
      if (complete) for (const family of GLYPH_FALLBACK_FAMILIES) wanted.add(fold(family));
      // The faces asked for when this shaping was built. A later step is due only when
      // these are held and a character is still uncovered, not while they still load.
      const held = new Set(wanted);
      const holds = (family: string): boolean => {
        try {
          const face = { family, weight: 400, style: 'normal' as const };
          return !(shaping.fonts.resolve(face) instanceof FontResolutionError);
        } catch {
          return false;
        }
      };
      const wrapped = withGlyphFallbacks(
        shaping,
        GLYPH_FALLBACK_FACES.filter((face) => held.has(fold(face.family))),
        {
          synthesizeSmallCaps: !cssSmallCaps,
          onUncovered(characters) {
            const next = glyphFallbackFamiliesFor(characters, (family) => held.has(fold(family)));
            const added = next.filter((family) => !wanted.has(fold(family)));
            if (added.length === 0) return;
            for (const family of added) wanted.add(fold(family));
            const inFonts = added.some(holds);
            pending ||= inFonts;
            request(inFonts);
          },
        }
      );
      wrappedShapings.set(wrapped, shaping);
      return wrapped;
    },
  };
}

/** `families` with the glyph fallback families first, within the resolver's bound. */
export function withGlyphFallbackFamilies(
  families: readonly string[],
  demand: GlyphFallbackDemand
): readonly string[] {
  const extra = demand.families();
  if (extra.length === 0) return families;
  const seen = new Set<string>();
  return [...extra, ...families]
    .filter((family) => !seen.has(fold(family)) && !!seen.add(fold(family)))
    .slice(0, MAX_RESOLVER_FAMILIES);
}

/**
 * The editor's side of the shared font fallback: the family rules over the host's faces, and
 * the glyph fallback chain. One per editor.
 *
 * `request` asks for the fonts again. It runs when a character needs a glyph fallback face
 * that was not asked for yet; `held` tells that the installed fonts already hold such a face.
 */
export function createEditorFallbackFonts(request: (held: boolean) => void) {
  const caches = createFallbackFaceCaches();
  const demand = createGlyphFallbackDemand(request);
  return {
    /** Forget the glyph fallback faces of the document before. */
    reset: demand.reset,
    shaping: demand.shaping,
    dispose: disposeFallbackShaping,
    pending: demand.pending,
    /**
     * The glyph fallback families asked for that `fonts` holds, as a part of the key of the
     * installed fonts. A step that brought no face leaves the key, and the layout, as it is.
     */
    key(fonts: FontConfiguration): string {
      const held = new Set([
        ...fonts.sources.map((source) => fold(source.request.family)),
        ...(fonts.substitutions ?? []).map(({ from }) => fold(from.family)),
      ]);
      return demand
        .families()
        .filter((family) => held.has(fold(family)))
        .join('\u0002');
    },
    /** The families to ask the host for, with the glyph fallback families that text needs. */
    families: (families: readonly string[]) => withGlyphFallbackFamilies(families, demand),
    /** `lookup` with the aliases of the held glyph fallback faces, for the CSS font stack. */
    paintAlias: <T extends (family: string) => string | undefined>(
      lookup: T,
      alias: (family: string) => string | undefined
    ): T => withGlyphFallbackAliases(lookup, demand.families().map(alias)),
    /**
     * Apply the family rules to one answer of the host. `key` names the document load and font
     * configuration, `host` is what the fallback faces are read from, and `installed` tells
     * the families the platform draws itself (absent: none).
     */
    async resolve(input: {
      /** The epoch of a configuration whose host states none: the document load. */
      readonly epoch: number;
      readonly key: string;
      readonly host: FallbackFaceHost;
      readonly explicit: FontConfigurationBase | undefined;
      /** The document's embedded fonts, and the byte budget they share with the host's. */
      readonly embedded: { readonly fonts: readonly EmbeddedFont[]; readonly maxFontBytes: number };
      readonly request: FontResolutionRequest;
      readonly installed: ((family: string) => boolean) | undefined;
      /** Finishes a composed configuration: the document's own substitutions, and the epoch. */
      readonly compose: (composed: FontConfiguration) => FontConfiguration;
    }): Promise<{
      /** The host's answer with the named fallback faces behind it. */
      readonly explicit: FontConfigurationBase | undefined;
      /** The families (case-folded) that render in a fallback face with other metrics. */
      readonly substituted: ReadonlySet<string>;
      /**
       * The configuration of `sources` (the host's faces that survive) and `own` (the
       * document's): the host's answer, the named fallback faces, the document's faces, then
       * the stand-ins. An exporter composes its font origins in this order.
       */
      compose(sources: readonly FontSource[], own: FontConfigurationFragment): FontConfiguration;
    }> {
      const shared = await resolveSharedFallbackFonts({
        explicit: input.explicit,
        embedded: embeddedFontSourcesAfterExplicit(
          input.embedded.fonts,
          input.explicit?.sources ?? [],
          input.embedded.maxFontBytes
        ).sources,
        request: input.request,
        host: input.host,
        cache: caches.of(input.key),
        installed: (family) => input.installed?.(family) ?? false,
      });
      const explicit = withNamedFallbackFonts(input.explicit, shared.named);
      // A stand-in face obeys the host's limit for one font, as its own faces do. The named
      // faces join the host's answer, which the caller bounds.
      const standIns: FontConfigurationFragment = {
        ...shared.standIns,
        sources: (shared.standIns.sources ?? []).filter(
          (source) => source.bytes.byteLength <= input.embedded.maxFontBytes
        ),
      };
      return {
        explicit,
        substituted: shared.substituted,
        compose: (sources, own) =>
          input.compose(
            composeFontConfiguration({ epoch: input.epoch, ...explicit, sources }, own, standIns)
          ),
      };
    },
  };
}
