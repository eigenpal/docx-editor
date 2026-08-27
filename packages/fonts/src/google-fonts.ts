/**
 * `@docx-editor.dev/fonts/google` — Google-hosted faces, fetched on demand.
 *
 * Nothing is bundled and nothing is fetched until a document turns out to name a family the
 * pinned catalog covers. Open a file using only Calibri and exactly one family is fetched.
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
 * const editor = createDocxEditor({ document: bytes, resolveFonts: googleFonts() });
 * ```
 *
 * @packageDocumentation
 * @public
 */
// @docx-editor.dev/fonts/google — Google-hosted faces, fetched on demand.
//
// `defaultFonts()` ships six families in the bundle and loads them whichever document
// opens. `googleFonts()` inverts both halves: nothing is bundled, and nothing is fetched
// until a document turns out to name a family the catalog covers. Open a file that uses
// only Calibri and exactly one family is fetched; open one that uses none of the catalog
// and no request is made at all.
//
// It is a `FontResolver`, so the editor calls it once per load with the families the file
// declares. That is the part to be deliberate about: it makes OPENING A DOCUMENT perform
// network requests, which the engine will never do on its own. What keeps it safe is that
// a declared family is only ever a LOOKUP KEY:
//
//   - The catalog is generated, closed and pinned (`google-catalog.generated.ts`). A name
//     is either in it or it is not; nothing is interpolated into a URL, so a crafted
//     `w:rFonts` cannot point this at a host of its choosing.
//   - Every URL is pinned to one immutable google/fonts commit and carries a baked
//     `sha256:`. Bytes are trusted by CONTENT, and the engine's admission path re-derives
//     the hash, so a swapped CDN asset fails there with a typed `hashMismatch`.
//   - The editor caps the families it hands over (`MAX_RESOLVER_FAMILIES`), so a file
//     declaring thousands of faces cannot fan this out into thousands of fetches.
//
// What it does NOT protect against is the CDN learning which families a document uses.
// That is inherent to fetching them, which is why nothing here is a default: an app opts
// in by passing `googleFonts()`, and `defaultFonts()` stays the zero-network answer.
//
// Metric compatibility is the reason the substitution maps are short. Carlito/Caladea/
// Tinos/Cousine have the same advance widths as the Word faces they stand in for. A second
// internal map records substitutes that pass a measured width gate without claiming exact
// compatibility. Anything else stays with the app's own `substitute` map.

import {
  GOOGLE_FONTS_REVISION,
  GOOGLE_FONT_CATALOG,
  type GoogleFontFace,
} from './google-catalog.generated.ts';
import type { DefaultFontSource, DefaultFontSubstitution } from './index.ts';

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
 * Recorded fidelity substitutes are close enough for the measured Word strings, but do
 * not claim the identical metrics promised by {@link GOOGLE_METRIC_SUBSTITUTES}.
 */
const GOOGLE_WIDTH_FIDELITY_SUBSTITUTES: Readonly<Record<string, string>> = Object.freeze({
  'Century Gothic': 'Montserrat',
});

/**
 * One catalogued face that did not arrive. Non-fatal: the resolver returns whatever else
 * succeeded, and the affected family falls back to the engine's fixed measurement.
 *
 * A `hashMismatch` does NOT appear here — bytes are trusted by content at the engine's
 * admission path, which rejects them after this resolver has handed them over.
 */
export interface GoogleFontLoadFailure {
  /** The family as the DOCUMENT named it, which may be the substituted-from name. */
  readonly family: string;
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
   * Narrow what may ever be fetched, by catalog family name. Omitted, any catalogued
   * family a document names is fair game; set it to run against a closed short list.
   */
  readonly allow?: readonly string[];
  /**
   * Extra document-family -> catalog-family mappings, merged over the built-in metric and
   * measured-width maps. Only metric-compatible pairs guarantee Word-accurate pagination.
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
 * Google catalog, fetching only what that document turned out to need.
 *
 * ```ts
 * <DocxEditor.Root fonts={googleFonts()} />
 * ```
 *
 * Compose it with your own bytes by wrapping it — the resolver is an ordinary async
 * function of the families, so a wrapper can merge fragments before returning.
 */
export function googleFonts(
  options: GoogleFontsOptions = {}
): (request: {
  readonly families: readonly string[];
  readonly defaultFamily: string;
}) => Promise<GoogleFontsFragment> {
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
    Object.entries({
      ...GOOGLE_METRIC_SUBSTITUTES,
      ...GOOGLE_WIDTH_FIDELITY_SUBSTITUTES,
      ...options.substitute,
    }).map(([from, to]) => [from.toLowerCase(), to] as const)
  );
  const allowed = options.allow
    ? new Set(options.allow.map((family) => family.toLowerCase()))
    : null;

  return async function resolveGoogleFonts(request) {
    // The default family counts as declared: a document whose runs name no font still
    // renders in one, and leaving it out would fetch nothing for a file that is entirely
    // default-styled.
    const wanted = new Map<string, readonly GoogleFontFace[]>();
    const substitutions: DefaultFontSubstitution[] = [];
    const failures: GoogleFontLoadFailure[] = [];

    for (const declared of [request.defaultFamily, ...request.families]) {
      const target = substitutes.get(declared.toLowerCase()) ?? declared;
      const faces = catalogByFamily.get(target.toLowerCase());
      if (!faces) continue;
      if (allowed && !allowed.has(target.toLowerCase())) continue;
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
    await Promise.all(
      [...wanted.values()].flat().map(async (face) => {
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
      })
    );

    // Deterministic regardless of which response landed first, so the same document
    // composes to the same configuration fingerprint on every load.
    sources.sort((left, right) => left.id.localeCompare(right.id));
    return { sources, substitutions, failures };
  };
}
