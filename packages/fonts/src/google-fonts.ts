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
  facesNeeded,
  planSourceFace,
  uncoveredFaces,
  type DefaultFontFamily,
} from './family-plans.ts';
import {
  GOOGLE_FONTS_REVISION,
  GOOGLE_FONT_CATALOG,
  type GoogleFontFace,
} from './google-catalog.generated.ts';
import { canIdle, fetchFontFile, idle } from './byte-cache.ts';
import { GOOGLE_CJK_FAMILY_NAMES, googleCjkFaceFor } from './google-cjk.ts';
import { loadDefaultFonts } from './index.ts';
import type {
  DefaultFontSource,
  DefaultFontSubstitution,
  FontLoading,
  FontOriginRequest,
  FontResolverMark,
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
const PACKAGED_ONLY_BY_NAME: ReadonlyMap<string, DefaultFontFamily> = new Map(
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
// The package entry's types this entry's signatures name, so a consumer importing only
// `@docx-editor.dev/fonts/google` can write them down.
export type {
  DefaultFontFaceRequest,
  DefaultFontSource,
  DefaultFontSubstitution,
  FontLoading,
  FontOriginRequest,
  FontResolverMark,
  ResolvedFontFace,
} from './index.ts';

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
 * render bold at regular weight. `packagedFonts()` covers both from the bundle.
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
  /**
   * How the faces of each font family load. A family has up to four faces: regular, bold,
   * italic, and bold italic. The text shows with estimated measurements until its fonts arrive.
   *
   * - `'progressive'` (default): the text switches to its own fonts when the faces it uses
   *   arrive. The other faces of the same families then load in the background, when the
   *   browser is idle, and install in one step ({@link GoogleFontsFragment.deferred}). A later bold
   *   or italic edit needs no download. Outside a browser, the other faces load when text
   *   first uses them.
   * - `'eager'`: the text switches to its own fonts when every face of its families arrives.
   * - `'lazy'`: only the faces the text uses load. Another face loads when text first uses
   *   it, and the text lays out again when it arrives.
   */
  readonly loading?: FontLoading;
  /**
   * Serve Chinese, Japanese, and Korean families, such as SimSun, MS Mincho, and Malgun
   * Gothic, with the regional Noto Sans face for each: JP, SC, TC, or KR. Off by default.
   *
   * `true` (or `{}`) loads them in the background: the first paint never waits for these
   * 4.6-8.5 MB faces, and the document lays out again when they arrive. Pass
   * `{ loading: 'wait' }` to install them with the document's other fonts instead. See
   * {@link CjkFontLoading}. A document export that receives this resolver waits for them.
   *
   * The face covers the family's text, not its metrics, so line breaks can differ. Use
   * this or `cjkFonts()` from `@docx-editor.dev/fonts-cjk`, not both: both would download.
   */
  readonly cjk?: boolean | GoogleCjkOptions;
}

/**
 * Whether a large CJK font download may delay the first paint.
 *
 * - `'background'`: the faces install in a separate step, after the document's other fonts.
 *   The first paint never waits for them, and text in them can move once when they arrive.
 * - `'wait'`: the faces install in the same step as the document's other fonts. A large
 *   document (over about 512 KB of uncompressed content) waits up to 2 seconds for them
 *   before its first paint. A small document paints at once and lays out again when all
 *   of its fonts arrive.
 *
 * Either way, a document export that receives this resolver waits for the faces.
 *
 * The same type as `CjkFontLoading` in `@docx-editor.dev/fonts-cjk/browser`.
 *
 * @public
 */
export type CjkFontLoading = 'background' | 'wait';

/**
 * How `googleFonts({ cjk })` loads Chinese, Japanese, and Korean faces.
 *
 * @public
 */
export interface GoogleCjkOptions {
  /** Defaults to `'background'`. See {@link CjkFontLoading}. */
  readonly loading?: CjkFontLoading;
}

/**
 * What {@link googleFonts} returns: a marked resolver over the pinned catalog.
 *
 * @public
 */
export type GoogleFontsResolver = ((request: FontOriginRequest) => Promise<GoogleFontsFragment>) &
  FontResolverMark;

/** What one resolver call produced, for callers that want it without the editor. */
export interface GoogleFontsFragment {
  /** Families this provider can serve after applying allow and substitute options. */
  readonly supportedFamilies?: readonly string[];
  readonly sources: readonly DefaultFontSource[];
  readonly substitutions: readonly DefaultFontSubstitution[];
  readonly failures: readonly GoogleFontLoadFailure[];
  /**
   * The faces that load in the background, settled after they download: the CJK faces with
   * `cjk.background`, and the other faces of the families in use
   * ({@link GoogleFontsOptions.loading}).
   */
  readonly deferred?: Promise<GoogleFontsFragment>;
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
export function googleFonts(options: GoogleFontsOptions = {}): GoogleFontsResolver {
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
  const cjk = options.cjk
    ? { background: options.cjk === true || options.cjk.loading !== 'wait' }
    : null;

  const supportedFamilies = Object.freeze(
    [
      ...new Set([
        ...GOOGLE_FONT_FAMILIES,
        ...PACKAGED_ONLY_FAMILIES,
        ...Object.keys({ ...GOOGLE_METRIC_SUBSTITUTES, ...options.substitute }),
      ]),
    ]
      .filter((family) => {
        const target = substitutes.get(family.toLowerCase());
        const bundled =
          target === undefined ? PACKAGED_ONLY_BY_NAME.get(family.toLowerCase()) : undefined;
        const resolved = bundled
          ? FAMILY_PLANS.get(bundled)?.substitute
          : catalogByFamily.get((target ?? family).toLowerCase())?.[0]?.family;
        return resolved !== undefined && (!allowed || allowed.has(resolved.toLowerCase()));
      })
      .concat(
        // The East Asian families `cjk` serves, so a font picker can offer them too. English
        // names only: a localized name is the same font listed twice.
        cjk
          ? GOOGLE_CJK_FAMILY_NAMES.filter(
              (entry) =>
                /^[\x20-\x7e]+$/.test(entry.family) &&
                (!allowed || allowed.has(entry.face.toLowerCase()))
            ).map((entry) => entry.family)
          : []
      )
  );

  async function resolveGoogleFonts(request: FontOriginRequest): Promise<GoogleFontsFragment> {
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
    /** Catalog faces of the families in use that no text uses yet, with their Word names. */
    const otherCatalogFaces = new Map<GoogleFontFace, string[]>();
    // The faces the document uses under one declared name, or every face when the request
    // does not say.
    // `'eager'` loads every face, as if the request named none.
    const neededFaces = facesNeeded(options.loading === 'eager' ? undefined : request.faces);
    const needs = (declared: string, face: { weight: number; style: string }): boolean =>
      neededFaces(declared).some(
        (need) => need.weight === face.weight && need.style === face.style
      );
    const substitutions: DefaultFontSubstitution[] = [];
    const failures: GoogleFontLoadFailure[] = [];
    /** Declared spelling -> the packaged Word family whose bundled bytes answer it. */
    const packaged = new Map<string, DefaultFontFamily>();
    /** The faces each bundled family loads. */
    const packagedStyles = new Map<DefaultFontFamily, Set<(typeof FACES)[number]>>();
    /** Regional CJK faces to load, with the declared names each one stands in for. */
    const cjkWanted = new Map<GoogleFontFace, string[]>();

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
        const needed = neededFaces(declared);
        const bundledCovered =
          plan !== undefined &&
          needed.every((face) => {
            const source = planSourceFace(plan, face);
            return (
              already.has(faceKey(declared, face.weight, face.style)) ||
              already.has(faceKey(plan.substitute, source.weight, source.style))
            );
          });
        if (plan && (!allowed || allowed.has(plan.substitute.toLowerCase())) && !bundledCovered) {
          packaged.set(declared, bundled);
          const styles = packagedStyles.get(bundled) ?? new Set();
          for (const face of needed) styles.add(face);
          packagedStyles.set(bundled, styles);
        }
        continue;
      }
      const faces = catalogByFamily.get((target ?? declared).toLowerCase());
      if (!faces) {
        const regional = cjk ? googleCjkFaceFor(target ?? declared) : undefined;
        if (
          regional &&
          (!allowed || allowed.has(regional.family.toLowerCase())) &&
          // Every face, or none, as on the catalog path: a covered regular must not leave the
          // bold and italic with neither bytes nor a substitution.
          neededFaces(declared).length > 0 &&
          !neededFaces(declared).every((face) =>
            already.has(faceKey(declared, face.weight, face.style))
          )
        ) {
          cjkWanted.set(regional, [...(cjkWanted.get(regional) ?? []), declared]);
        }
        continue;
      }
      if (allowed && !allowed.has(faces[0]!.family.toLowerCase())) continue;
      // Only the faces the document uses. A face the catalog lacks (a family with no italic)
      // stays unloaded, as before.
      const used = faces.filter((face) => needs(declared, face));
      if (used.length === 0) continue;
      // EVERY catalogued face, or none. A family is fetched whole, so skipping one whose
      // regular is covered but whose bold is not would leave the bold with neither bytes
      // nor a substitution. Each face counts as covered under the name the document wrote
      // OR under the catalog family this would fetch, because an earlier origin may have
      // reported either — `packagedFonts()` reports both, a raw byte fragment only the
      // face it supplied.
      const covered = used.every(
        (face) =>
          already.has(faceKey(declared, face.weight, face.style)) ||
          already.has(faceKey(face.family, face.weight, face.style))
      );
      if (covered) continue;
      wanted.set(faces[0]!.family, used);
      for (const face of faces)
        if (!used.includes(face))
          otherCatalogFaces.set(face, [...(otherCatalogFaces.get(face) ?? []), declared]);
      // Only when the document's own name differs from the face being loaded: a run
      // saying "Carlito" needs the bytes, not a Carlito -> Carlito redirect.
      //
      // Compared against the CATALOG family rather than the substitution target, so a
      // run spelled "carlito" is still mapped onto the "Carlito" face. Face keys are
      // case-sensitive (`fontRequestKey` stringifies the family verbatim), so without
      // this the bytes would be fetched and measured but painted in a platform
      // substitute — the alias is only ever found under the name the run actually wrote.
      if (faces[0]!.family !== declared) {
        for (const face of used) {
          substitutions.push({
            from: { family: declared, weight: face.weight, style: face.style },
            to: { family: face.family, weight: face.weight, style: face.style },
          });
        }
      }
    }

    const sources: DefaultFontSource[] = [];
    /** Load packaged faces, and map them onto the names the document wrote. */
    const loadPackaged = async (
      entries: readonly (readonly [DefaultFontFamily, ReadonlySet<(typeof FACES)[number]>])[],
      into: { sources: DefaultFontSource[]; substitutions: DefaultFontSubstitution[] },
      failed: GoogleFontLoadFailure[]
    ): Promise<void> => {
      if (entries.length === 0) return;
      const fragments = await Promise.all(
        entries.map(([family, styles]) =>
          loadDefaultFonts({
            families: [family],
            faces: FACES.filter((face) => styles.has(face)),
            fetcher,
            signal: request.signal,
          })
        )
      );
      const fragment = {
        sources: fragments.flatMap((part) => part.sources),
        substitutions: fragments.flatMap((part) => part.substitutions),
        failures: fragments.flatMap((part) => part.failures),
      };
      into.sources.push(...fragment.sources);
      // Re-keyed onto the DOCUMENT's spelling for the same reason the catalog path does
      // it: the painter finds a face's alias under the name the run actually wrote.
      for (const [declared, family] of packaged) {
        for (const entry of fragment.substitutions) {
          if (entry.from.family !== family) continue;
          into.substitutions.push({ ...entry, from: { ...entry.from, family: declared } });
        }
      }
      for (const failure of fragment.failures) {
        const record = {
          family: failure.family,
          url: failure.file,
          diagnostic: failure.diagnostic,
        };
        failed.push(record);
        if (options.onFailure) options.onFailure(record);
        else console.warn(`[fonts] ${record.family} (${record.url}): ${record.diagnostic}`);
      }
    };
    const packagedJob = (): Promise<void> =>
      loadPackaged([...packagedStyles], { sources, substitutions }, failures);
    const fetchInto = async (
      face: GoogleFontFace,
      into: DefaultFontSource[],
      failed: GoogleFontLoadFailure[],
      cjkFace = false,
      low = false
    ): Promise<void> => {
      try {
        const bytes = await fetchFontFile(
          { url: face.url, byteLength: face.byteLength, source: 'catalogued' },
          fetcher,
          request.signal,
          cjkFace,
          low
        );
        into.push({
          request: { family: face.family, weight: face.weight, style: face.style },
          id: `google-fonts:${face.family}#${face.weight}#${face.style}`,
          bytes,
          hash: face.hash,
          faceIndex: 0,
        });
      } catch (error) {
        // A cancelled load is the document moving on, not a failed face.
        if (request.signal?.aborted) return;
        const failure = {
          family: face.family,
          url: face.url,
          diagnostic: error instanceof Error ? error.message : String(error),
        };
        failed.push(failure);
        if (options.onFailure) options.onFailure(failure);
        else console.warn(`[fonts] ${face.family} (${face.url}): ${failure.diagnostic}`);
      }
    };
    // CJK faces have one weight and style, so every face of a declared family points at it.
    const loadCjk = async (): Promise<GoogleFontsFragment> => {
      const cjkSources: DefaultFontSource[] = [];
      const cjkFailures: GoogleFontLoadFailure[] = [];
      // A regional face an earlier origin already paints needs only the redirects, not a
      // second third-party download of the same bytes.
      const painted = (face: GoogleFontFace) =>
        already.has(faceKey(face.family, face.weight, face.style));
      await Promise.all(
        [...cjkWanted.keys()]
          .filter((face) => !painted(face))
          .map((face) => fetchInto(face, cjkSources, cjkFailures, true))
      );
      const loaded = new Set([
        ...cjkSources.map((source) => source.request.family),
        ...[...cjkWanted.keys()].filter(painted).map((face) => face.family),
      ]);
      const cjkSubstitutions = [...cjkWanted].flatMap(([face, declaredNames]) =>
        loaded.has(face.family)
          ? declaredNames.flatMap((declared) =>
              FACES.filter(
                // The face itself needs bytes, not a redirect; its bold and italic need one.
                ({ weight, style }) =>
                  declared !== face.family || weight !== 400 || style !== 'normal'
              ).map(({ weight, style }) => ({
                from: { family: declared, weight, style },
                to: { family: face.family, weight: 400, style: 'normal' as const },
              }))
            )
          : []
      );
      cjkSources.sort((left, right) => left.id.localeCompare(right.id));
      return { sources: cjkSources, substitutions: cjkSubstitutions, failures: cjkFailures };
    };
    const deferCjk = cjk?.background === true && cjkWanted.size > 0;
    const immediate = Promise.all([
      packagedJob(),
      Promise.all([...wanted.values()].flat().map((face) => fetchInto(face, sources, failures))),
    ]);
    // Background CJK downloads start once the first-paint faces are in, so 4-8 MB faces never
    // compete with them for bandwidth. A resolution that failed downloads none: nobody would
    // receive them.
    const cjkLater = deferCjk
      ? immediate.then(loadCjk, () => ({ sources: [], substitutions: [], failures: [] }))
      : undefined;
    const [, cjkNow] = await Promise.all([
      immediate,
      cjkWanted.size > 0 && !deferCjk ? loadCjk() : undefined,
    ]);
    const otherLater = loadOtherFacesLater();
    if (cjkNow) {
      sources.push(...cjkNow.sources);
      substitutions.push(...cjkNow.substitutions);
      failures.push(...cjkNow.failures);
    }

    // Deterministic regardless of which response landed first, so the same document
    // composes to the same configuration fingerprint on every load.
    sources.sort((left, right) => left.id.localeCompare(right.id));
    return {
      sources,
      substitutions,
      failures,
      supportedFamilies,
      ...(cjkLater || otherLater ? { deferred: bothLater(cjkLater, otherLater)! } : {}),
    };

    /**
     * The faces of the families in use that no text uses yet and no earlier origin paints,
     * loaded when the browser is idle after the faces in use: they never share its bandwidth.
     */
    function loadOtherFacesLater(): Promise<GoogleFontsFragment> | undefined {
      if (
        !request.faces ||
        options.loading === 'lazy' ||
        options.loading === 'eager' ||
        request.signal?.aborted
      )
        return;
      if (!canIdle()) return;
      const covered = (family: string, weight: number, style: string): boolean =>
        already.has(faceKey(family, weight, style));
      const catalog = [...otherCatalogFaces].filter(
        ([face]) => !covered(face.family, face.weight, face.style)
      );
      const bundled = [...new Set(packaged.values())].flatMap((family) => {
        const faces = uncoveredFaces(family, FAMILY_PLANS.get(family)!, covered).filter(
          (face) => !packagedStyles.get(family)?.has(face)
        );
        return faces.length > 0 ? [[family, new Set(faces)] as const] : [];
      });
      if (catalog.length === 0 && bundled.length === 0) return;
      const later = idle(request.signal).then(async (): Promise<GoogleFontsFragment> => {
        const into = {
          sources: [] as DefaultFontSource[],
          substitutions: [] as DefaultFontSubstitution[],
        };
        const failed: GoogleFontLoadFailure[] = [];
        await Promise.all([
          ...catalog.map(([face]) => fetchInto(face, into.sources, failed, false, true)),
          loadPackaged(bundled, into, failed),
        ]);
        const loaded = new Set(into.sources.map((source) => fontKey(source.request)));
        for (const [face, declaredNames] of catalog) {
          if (!loaded.has(fontKey(face))) continue;
          for (const declared of declaredNames)
            if (face.family !== declared)
              into.substitutions.push({
                from: { family: declared, weight: face.weight, style: face.style },
                to: { family: face.family, weight: face.weight, style: face.style },
              });
        }
        into.sources.sort((left, right) => left.id.localeCompare(right.id));
        return { ...into, failures: failed, supportedFamilies };
      });
      // Nothing may wait on it: a cancelled or failed background load is not an error.
      later.catch(() => {});
      return later;
    }
  }

  const descriptor = { value: true, enumerable: false, configurable: true } as const;
  Object.defineProperty(resolveGoogleFonts, FONT_RESOLVER_BRAND, descriptor);
  Object.defineProperty(resolveGoogleFonts, FONT_RESOLVER_MARK_KEY, descriptor);
  return resolveGoogleFonts as typeof resolveGoogleFonts & FontResolverMark;
}

const fontKey = (face: { family: string; weight: number; style: string }): string =>
  `${face.family}\u0000${face.weight}\u0000${face.style}`;

/**
 * The background loads as one late answer: the load that settles first installs first, and
 * carries the other one as its own `deferred`, so neither waits for the other.
 */
function bothLater(
  first: Promise<GoogleFontsFragment> | undefined,
  second: Promise<GoogleFontsFragment> | undefined
): Promise<GoogleFontsFragment> | undefined {
  if (!first || !second) return first ?? second;
  const carry = (
    settled: Promise<GoogleFontsFragment>,
    other: Promise<GoogleFontsFragment>
  ): Promise<GoogleFontsFragment> =>
    settled.then(
      (fragment) => ({ ...fragment, deferred: other }),
      () => other
    );
  return Promise.race([carry(first, second), carry(second, first)]);
}
