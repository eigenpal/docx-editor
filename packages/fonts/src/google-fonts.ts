/**
 * `@docx-editor.dev/fonts/google` — Google-hosted faces, fetched on demand.
 *
 * Nothing is fetched until a document turns out to name a family this module can answer.
 * Open a file using only Calibri and exactly one family is fetched.
 *
 * Be deliberate about this: it makes OPENING A DOCUMENT perform network requests, which the
 * engine never does on its own. What keeps it safe is that a document-declared family is only
 * ever a LOOKUP KEY against a closed, commit-pinned catalog, and every face is trusted by
 * content hash rather than by origin.
 *
 * @example Resolve catalogued families as documents need them
 * ```ts
 * import { googleFonts } from '@docx-editor.dev/fonts/google';
 *
 * const editor = createDocxEditor({ document: bytes, fonts: googleFonts() });
 * ```
 *
 * @packageDocumentation
 * @public
 */
// @docx-editor.dev/fonts/google — Google-hosted faces, fetched on demand.
//
// `defaultFonts()` loads Word's five document-default families whichever document opens.
// `googleFonts()` inverts that: nothing loads until a document turns out to name a family
// this module can answer. Open a file that uses only Calibri and exactly one family is
// fetched; open one that names nothing it covers and no request is made at all.
//
// Two things can answer a name. Most come from the pinned Google catalog, over the
// network. A short list comes from the package's OWN bundled assets
// (`PACKAGED_ONLY_FAMILIES`) because no catalog family is metric-compatible with them —
// Century Gothic is the one, answered by TeX Gyre Adventor. That path reads the package's
// own assets, so it makes no third-party request; it is not request-free.
//
// It is a `FontResolver`, so the editor calls it once per load with the families the file
// declares. That is the part to be deliberate about: it makes OPENING A DOCUMENT perform
// network requests, which the engine will never do on its own. What keeps it safe is that
// a declared family is only ever a LOOKUP KEY:
//
//   - The catalog is generated, closed and pinned (`google-catalog.generated.ts`). A name
//     is either in it or it is not; nothing is interpolated into a URL, so a crafted
//     `w:rFonts` cannot point this at a host of its choosing.
//   - Every URL is pinned to an immutable google/fonts commit and carries a baked
//     `sha256:`. Most faces share one commit; a family whose current upstream version is
//     variable-only is pinned to the last commit that carried static instances, so the
//     catalog records more than one revision. Bytes are trusted by CONTENT, and the
//     engine's admission path re-derives the hash, so a swapped CDN asset fails there
//     with a typed `hashMismatch`.
//   - The editor caps the families it hands over (`MAX_RESOLVER_FAMILIES`), so a file
//     declaring thousands of faces cannot fan this out into thousands of fetches.
//
// What it does NOT protect against is the CDN learning which families a document uses.
// That is inherent to fetching them, which is why nothing here is a default: an app opts
// in by passing `googleFonts()`, and `defaultFonts()` stays the zero-network answer.
//
// Metric compatibility is the reason the substitution map is short. Carlito/Caladea/
// Tinos/Cousine have the same advance widths as the Word faces they stand in for, so wrap
// and pagination land where Word puts them. Century Gothic is answered from this package's
// own bundled TeX Gyre Adventor, which is close rather than identical (within 1%).
//
// Anything else would be a guess that moves line breaks, so it is left to the app's own
// `substitute` map rather than assumed here. A PANOSE-ranked substitute was tried and
// removed: PANOSE states a CLASSIFICATION, never an advance width, so no threshold on it
// bounds the width error — the ranking picked faces 22-24% wider than the family a
// document named, which is worse than the fixed fallback it replaced.

import {
  FACES,
  FAMILY_PLANS,
  PACKAGED_ONLY_FAMILIES,
  type WordDefaultFamily,
} from './family-plans.ts';
import {
  GOOGLE_FONTS_REVISION,
  GOOGLE_FONT_CATALOG,
  type GoogleFontFace,
} from './google-catalog.generated.ts';
import { loadDefaultFonts } from './index.ts';
import type {
  DefaultFontSource,
  DefaultFontSubstitution,
  FontResolverMark,
  ResolvedFontFace,
} from './index.ts';

/**
 * Word families the package ships bytes for that the catalog cannot serve, keyed by the
 * case-folded name a document would write.
 *
 * Century Gothic is the concrete one: no google/fonts family is metric-compatible with
 * it, while the packaged TeX Gyre Adventor lands within 1% of Word's own widths. Serving
 * it from the bundle here is what makes `googleFonts()` the ON-DEMAND path for it, so
 * `defaultFonts()` does not have to load ~709 KB of it for every document that never asks.
 */
const PACKAGED_ONLY_BY_NAME: ReadonlyMap<string, WordDefaultFamily> = new Map(
  PACKAGED_ONLY_FAMILIES.map((family) => [family.toLowerCase(), family] as const)
);

/**
 * Same registered symbol `packagedFonts` and the engine's `defineFontResolver` use, so
 * `useDocxSource` can tell an on-demand resolver from a zero-argument loader. Spelled out
 * rather than imported, to keep this package free of any dependency on the engine.
 */
const FONT_RESOLVER_BRAND: unique symbol = Symbol.for('docx-editor.dev/font-resolver') as never;

/** The string half of the same mark; see `FontResolverMark` in the package entry. */
const FONT_RESOLVER_MARK_KEY = 'docx-editor.dev/font-resolver';

/** Case-folded face identity, matching how the engine keys `resolvedFaces`. */
const faceKey = (family: string, weight: number, style: string): string =>
  `${family.trim().toLowerCase()} ${weight} ${style}`;

export { GOOGLE_FONTS_REVISION, GOOGLE_FONT_CATALOG, type GoogleFontFace };

/** Every family the catalog can serve, sorted — the set a font picker may offer. */
export const GOOGLE_FONT_FAMILIES: readonly string[] = Object.freeze([
  ...new Set(GOOGLE_FONT_CATALOG.map((face) => face.family)),
]);

/**
 * Word families with a METRIC-COMPATIBLE catalogued stand-in: identical advance widths,
 * so a document laid out on the substitute paginates like Word.
 *
 * Arial and Helvetica are absent on purpose. Their match is Arimo, which google/fonts now
 * ships variable-only, and the shaper refuses variation axes — a variable file would
 * render bold at regular weight. `defaultFonts()` still covers them from the bundle.
 */
export const GOOGLE_METRIC_SUBSTITUTES: Readonly<Record<string, string>> = Object.freeze({
  Calibri: 'Carlito',
  Cambria: 'Caladea',
  'Times New Roman': 'Tinos',
  'Courier New': 'Cousine',
});

/**
 * One face that did not arrive. Non-fatal: the resolver returns whatever else succeeded,
 * and the affected family falls back to the engine's fixed measurement.
 *
 * A `hashMismatch` does NOT appear here — bytes are trusted by content at the engine's
 * admission path, which rejects them after this resolver has handed them over.
 */
export interface GoogleFontLoadFailure {
  /**
   * The family of the face that failed to load — the SERVING name ("Carlito", "TeX Gyre
   * Adventor"), not the name the document wrote. A document naming Calibri sees "Carlito"
   * here, because that is the file that did not arrive.
   */
  readonly family: string;
  /** The pinned catalog URL, or the asset filename for a face served from the bundle. */
  readonly url: string;
  readonly diagnostic: string;
}

/**
 * How `googleFonts()` behaves once a document hands it a family list. Every field is
 * optional; `googleFonts()` with no options fetches any catalogued family a document
 * names, over the global `fetch`, warning to the console on failure.
 */
export interface GoogleFontsOptions {
  /**
   * Narrow what may ever load, by the name of the face that would SERVE the request
   * ("Carlito", "TeX Gyre Adventor"). Omitted, any family this module can answer is fair
   * game; set it to run against a closed short list.
   */
  readonly allow?: readonly string[];
  /**
   * Extra document-family -> catalog-family mappings, merged OVER
   * {@link GOOGLE_METRIC_SUBSTITUTES}. Only metric-compatible pairs keep pagination
   * Word-accurate; anything else trades line breaks for closer-looking glyphs.
   */
  readonly substitute?: Readonly<Record<string, string>>;
  /** Injectable for tests and CSP-constrained hosts; defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
  /** Per-face failures. Defaults to a console warning; pass a handler to route them. */
  readonly onFailure?: (failure: GoogleFontLoadFailure) => void;
}

/** What one resolver call produced, for callers that want it without the editor. */
export interface GoogleFontsFragment {
  readonly sources: readonly DefaultFontSource[];
  readonly substitutions: readonly DefaultFontSubstitution[];
  readonly failures: readonly GoogleFontLoadFailure[];
}

/** Case-insensitive family lookup, built once for the module's lifetime. */
const catalogByFamily = ((): ReadonlyMap<string, readonly GoogleFontFace[]> => {
  const byFamily = new Map<string, GoogleFontFace[]>();
  for (const face of GOOGLE_FONT_CATALOG) {
    const key = face.family.toLowerCase();
    const faces = byFamily.get(key);
    if (faces) faces.push(face);
    else byFamily.set(key, [face]);
  }
  return byFamily;
})();

/**
 * Bytes already fetched this session, keyed by pinned URL — and PER FETCHER.
 *
 * Immutable URLs make the cache trivially safe to share, and sharing is what makes a
 * second document naming the same family cost nothing; in-flight promises are cached too,
 * so two editors mounting at once fetch a face once. Keying on the fetcher keeps that
 * sharing where it belongs: hosts all using the global `fetch` share one cache, while a
 * host that supplied its own (a CSP-constrained proxy, a test double) never receives
 * bytes some other fetcher produced. A `WeakMap` so a discarded fetcher's bytes go too.
 */
const byteCaches = new WeakMap<object, Map<string, Promise<Uint8Array>>>();

function cacheFor(fetcher: typeof fetch): Map<string, Promise<Uint8Array>> {
  let cache = byteCaches.get(fetcher);
  if (!cache) {
    cache = new Map();
    byteCaches.set(fetcher, cache);
  }
  return cache;
}

async function fetchFace(face: GoogleFontFace, fetcher: typeof fetch): Promise<Uint8Array> {
  const byteCache = cacheFor(fetcher);
  const inFlight = byteCache.get(face.url);
  if (inFlight) return inFlight;
  const pending = (async () => {
    const response = await fetcher(face.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // The cheap half of content-checking, done here so an error page served with 200
    // never reaches the engine. The hash half is the engine's: it re-derives on admission
    // and refuses a mismatch, so a tampered asset fails loudly there rather than silently.
    if (bytes.byteLength !== face.byteLength) {
      throw new Error(`unexpected byte length ${bytes.byteLength}, catalogued ${face.byteLength}`);
    }
    return bytes;
  })();
  byteCache.set(face.url, pending);
  // A failed fetch must not be remembered as a failure forever: the next document gets to
  // try again. Only successes stay cached.
  pending.catch(() => byteCache.delete(face.url));
  return pending;
}

/**
 * A {@link FontResolver} that serves the document's declared families from the pinned
 * Google catalog — plus the package's own bundled faces for families the catalog has no
 * metric-compatible answer for — loading only what that document turned out to need.
 *
 * ```ts
 * <DocxEditor.Root fonts={googleFonts()} />
 * ```
 *
 * Same call shape as `packagedFonts()` from `@docx-editor.dev/fonts`, so the two compose
 * by sitting next to each other: `useFonts(packagedFonts(), googleFonts())` serves the
 * bundled faces first and reaches the catalog only for what they do not cover.
 *
 * Compose it with your own bytes by wrapping it — the resolver is an ordinary async
 * function of the families, so a wrapper can merge fragments before returning.
 */
export function googleFonts(
  options: GoogleFontsOptions = {}
): ((request: {
  readonly families: readonly string[];
  readonly defaultFamily: string;
  readonly resolvedFaces?: readonly ResolvedFontFace[];
}) => Promise<GoogleFontsFragment>) &
  FontResolverMark {
  const fetcher = options.fetcher ?? fetch;
  /**
   * Document family (case-folded) -> catalog family.
   *
   * A `Map` built from OWN entries, not an object literal indexed by a file-derived name:
   * `substitutes['constructor']` on a plain object answers with `Object`, and the lookup
   * would go on to call `.toLowerCase()` on a function — one `w:rFonts w:ascii="toString"`
   * away from throwing out of the resolver and dropping every other family with it.
   *
   * Case-folded because Word matches font names case-insensitively and the catalog lookup
   * below already does; an exact-case map left `w:ascii="calibri"` resolving to nothing at
   * all while `Calibri` resolved to four faces.
   */
  const substitutes = new Map<string, string>(
    Object.entries({ ...GOOGLE_METRIC_SUBSTITUTES, ...options.substitute }).map(
      ([from, to]) => [from.toLowerCase(), to] as const
    )
  );
  const allowed = options.allow
    ? new Set(options.allow.map((family) => family.toLowerCase()))
    : null;

  async function resolveGoogleFonts(request: {
    readonly families: readonly string[];
    readonly defaultFamily: string;
    readonly resolvedFaces?: readonly ResolvedFontFace[];
  }): Promise<GoogleFontsFragment> {
    // Faces an earlier origin can already PAINT. Skipping them is not only bytes: a face
    // the composition would drop anyway is a CDN request that tells a third party which
    // families this document uses, for nothing at all.
    const already = new Set(
      (request.resolvedFaces ?? []).map((face) => faceKey(face.family, face.weight, face.style))
    );
    // The default family counts as declared: a document whose runs name no font still
    // renders in one, and leaving it out would fetch nothing for a file that is entirely
    // default-styled.
    const wanted = new Map<string, readonly GoogleFontFace[]>();
    const substitutions: DefaultFontSubstitution[] = [];
    const failures: GoogleFontLoadFailure[] = [];
    /** Declared spelling -> the packaged Word family whose bundled bytes answer it. */
    const packaged = new Map<string, WordDefaultFamily>();

    for (const declared of [request.defaultFamily, ...request.families]) {
      const target = substitutes.get(declared.toLowerCase());
      // The bundled answer is a DEFAULT, so it is checked after the substitution map and
      // not before it. Checking it first made a packaged family the one name `substitute`
      // could not override — silently, and worse under `allow`, where naming the override
      // target excluded the bundled face too and the family resolved to nothing at all.
      const bundled =
        target === undefined ? PACKAGED_ONLY_BY_NAME.get(declared.toLowerCase()) : undefined;
      if (bundled) {
        const plan = FAMILY_PLANS.get(bundled);
        // EVERY packaged face, or none — the same rule the catalog path below applies, and
        // for the same reason: this reads a family whole, so skipping one whose regular is
        // covered but whose bold is not would leave the bold with no bytes at all.
        const bundledCovered =
          plan !== undefined &&
          FACES.every(
            (face) =>
              already.has(faceKey(declared, face.weight, face.style)) ||
              already.has(faceKey(plan.substitute, face.weight, face.style))
          );
        if (plan && (!allowed || allowed.has(plan.substitute.toLowerCase())) && !bundledCovered) {
          packaged.set(declared, bundled);
        }
        continue;
      }
      const faces = catalogByFamily.get((target ?? declared).toLowerCase());
      if (!faces) continue;
      if (allowed && !allowed.has(faces[0]!.family.toLowerCase())) continue;
      // EVERY catalogued face, or none. A family is fetched whole, so skipping one whose
      // regular is covered but whose bold is not would leave the bold with neither bytes
      // nor a substitution. Each face counts as covered under the name the document wrote
      // OR under the catalog family this would fetch, because an earlier origin may have
      // reported either — `packagedFonts()` reports both, a raw byte fragment only the
      // face it supplied.
      const covered = faces.every(
        (face) =>
          already.has(faceKey(declared, face.weight, face.style)) ||
          already.has(faceKey(face.family, face.weight, face.style))
      );
      if (covered) continue;
      wanted.set(faces[0]!.family, faces);
      // Only when the document's own name differs from the face being loaded: a run
      // saying "Carlito" needs the bytes, not a Carlito -> Carlito redirect.
      //
      // Compared against the CATALOG family rather than the substitution target, so a
      // run spelled "carlito" is still mapped onto the "Carlito" face. Face keys are
      // case-sensitive (`fontRequestKey` stringifies the family verbatim), so without
      // this the bytes would be fetched and measured but painted in a platform
      // substitute — the alias is only ever found under the name the run actually wrote.
      if (faces[0]!.family !== declared) {
        for (const face of faces) {
          substitutions.push({
            from: { family: declared, weight: face.weight, style: face.style },
            to: { family: face.family, weight: face.weight, style: face.style },
          });
        }
      }
    }

    const sources: DefaultFontSource[] = [];
    const packagedJob = async (): Promise<void> => {
      if (packaged.size === 0) return;
      const fragment = await loadDefaultFonts({
        families: [...new Set(packaged.values())],
        fetcher,
      });
      sources.push(...fragment.sources);
      // Re-keyed onto the DOCUMENT's spelling for the same reason the catalog path does
      // it: the painter finds a face's alias under the name the run actually wrote.
      for (const [declared, family] of packaged) {
        for (const entry of fragment.substitutions) {
          if (entry.from.family !== family) continue;
          substitutions.push({ ...entry, from: { ...entry.from, family: declared } });
        }
      }
      for (const failure of fragment.failures) {
        const record = {
          family: failure.family,
          url: failure.file,
          diagnostic: failure.diagnostic,
        };
        failures.push(record);
        if (options.onFailure) options.onFailure(record);
        else console.warn(`[fonts] ${record.family} (${record.url}): ${record.diagnostic}`);
      }
    };
    await Promise.all([
      packagedJob(),
      ...[...wanted.values()].flat().map(async (face) => {
        try {
          const bytes = await fetchFace(face, fetcher);
          sources.push({
            request: { family: face.family, weight: face.weight, style: face.style },
            id: `google-fonts:${face.family}#${face.weight}#${face.style}`,
            bytes,
            hash: face.hash,
            faceIndex: 0,
          });
        } catch (error) {
          const failure = {
            family: face.family,
            url: face.url,
            diagnostic: error instanceof Error ? error.message : String(error),
          };
          failures.push(failure);
          if (options.onFailure) options.onFailure(failure);
          else console.warn(`[fonts] ${face.family} (${face.url}): ${failure.diagnostic}`);
        }
      }),
    ]);

    // Deterministic regardless of which response landed first, so the same document
    // composes to the same configuration fingerprint on every load.
    sources.sort((left, right) => left.id.localeCompare(right.id));
    return { sources, substitutions, failures };
  }

  const descriptor = { value: true, enumerable: false, configurable: true } as const;
  Object.defineProperty(resolveGoogleFonts, FONT_RESOLVER_BRAND, descriptor);
  Object.defineProperty(resolveGoogleFonts, FONT_RESOLVER_MARK_KEY, descriptor);
  return resolveGoogleFonts as typeof resolveGoogleFonts & FontResolverMark;
}
