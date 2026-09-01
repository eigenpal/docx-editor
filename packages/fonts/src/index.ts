/**
 * `@docx-editor.dev/fonts` — metric-compatible substitutes for common Word faces.
 *
 * Word's own defaults (Calibri, Cambria, Times New Roman, Arial, Courier New) are proprietary
 * and cannot ship in an open package. What CAN ship are the faces built to MATCH THEIR METRICS:
 * identical advance widths, so wrap and pagination land where Word puts them even though the
 * glyph outlines differ slightly.
 *
 * Nothing loads until an app calls in. Importing this module fetches no bytes, and the editor
 * engine never calls it on its own.
 *
 * @example Serve the packaged substitutes on demand
 * ```ts
 * import { packagedFonts } from '@docx-editor.dev/fonts';
 *
 * const editor = createDocxEditor({ document: bytes, fonts: packagedFonts() });
 * ```
 *
 * @example Load Word's five document defaults up front instead
 * ```ts
 * import { defaultFonts } from '@docx-editor.dev/fonts';
 *
 * const fonts = await defaultFonts();
 * const editor = createDocxEditor({ document: bytes, fonts });
 * ```
 *
 * @packageDocumentation
 * @public
 */
// @docx-editor.dev/fonts — metric-compatible substitutes for common Word faces.
//
// Word's own defaults (Calibri, Cambria, Times New Roman, Arial, Courier New) are
// proprietary and cannot ship in an open package. What CAN ship are the faces built to
// MATCH THEIR METRICS — identical advance widths, so wrap and pagination land where Word
// puts them even though the glyph outlines differ slightly:
//
//   Calibri         → Carlito            (SIL OFL)
//   Cambria         → Caladea            (SIL OFL)
//   Times New Roman → Liberation Serif   (SIL OFL)
//   Arial           → Liberation Sans    (SIL OFL)
//   Courier New     → Liberation Mono    (SIL OFL)
//   Century Gothic  → TeX Gyre Adventor  (GUST Font License)
//
// The first five are Word's DOCUMENT defaults, so they are what `loadDefaultFonts()` loads
// when `families` is omitted. Century Gothic is not a document default and most files never
// name it, so its four ~175 KB assets are opt-in: use `packagedFonts()`, which loads the
// packaged bytes for any of the six only when a document asks — no network either way — or
// pass `families` explicitly to the eager loader. `googleFonts()` serves it from the same
// bundled bytes too, for an app already opted into the catalog.
//
// `loadDefaultFonts()` fetches the packaged font files (lazily, only the families asked for)
// and returns a configuration FRAGMENT — sources plus the Word-name→substitute map —
// ready for `composeFontConfiguration`. Nothing loads until the app calls it: importing
// this module fetches no bytes, and the editor engine itself never calls in here.
//
// Hashes are baked at packaging time (src/manifest.generated.ts, CI-verified against the
// shipped assets), so fetched bytes are content-checked without hashing at runtime and a
// tampered asset pipeline fails loudly.
//
// The types here are STRUCTURAL copies of the editor contract's `FontSource` /
// `FontSourceSubstitution` — assignable by shape — so this package has no runtime or
// type dependency on the engine and the engine has none on it.

import { FACES, FAMILY_PLANS, planFaceFile, planLineBox } from './family-plans.ts';
import type { WordDefaultFamily } from './family-plans.ts';
import { FONT_ASSET_MANIFEST, FONT_ASSET_URLS } from './manifest.generated.ts';

export type { WordDefaultFamily } from './family-plans.ts';

/** A concrete font face request, structurally identical to the editor contract's. */
export interface DefaultFontFaceRequest {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/** A byte-backed source, structurally identical to the editor contract's `FontSource`. */
export interface DefaultFontSource {
  readonly request: DefaultFontFaceRequest;
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
  readonly faceIndex: number;
}

/**
 * One Word-name → substitute redirect, structurally identical to the editor contract's
 * `FontSourceSubstitution`. `from` is the proprietary face a document asks for, `to` is
 * the metric-compatible face this package actually ships.
 */
export interface DefaultFontSubstitution {
  readonly from: DefaultFontFaceRequest;
  readonly to: DefaultFontFaceRequest;
  readonly lineMetrics?: {
    readonly heightEm: number;
    readonly baselineEm: number;
  };
}

/**
 * One face that did not load. `family` is the Word name that was asked for, `file` the
 * packaged asset that failed, and `diagnostic` a human-readable cause — a missing
 * manifest entry, an HTTP status, a byte-length mismatch against the baked manifest, or
 * a thrown fetch error.
 *
 * Non-fatal by design: the surrounding fragment stays usable and the affected family
 * falls back to the engine's fixed measurement.
 */
export interface DefaultFontLoadFailure {
  readonly family: string;
  readonly file: string;
  readonly diagnostic: string;
}

/** What `loadDefaultFonts` resolves to — composes as a `FontConfigurationFragment`. */
export interface DefaultFontsFragment {
  readonly sources: readonly DefaultFontSource[];
  readonly substitutions: readonly DefaultFontSubstitution[];
  /** Faces that failed to load; the rest of the fragment is still usable. */
  readonly failures: readonly DefaultFontLoadFailure[];
}

/**
 * Options shared by {@link loadDefaultFonts}, {@link installDefaultFontFaces} and
 * {@link defaultFonts}. Both fields are optional, so `{}` loads
 * {@link WORD_DOCUMENT_DEFAULT_FAMILIES} over the global `fetch`.
 */
export interface LoadDefaultFontsOptions {
  /**
   * Narrow or widen the families to load. The default is
   * {@link WORD_DOCUMENT_DEFAULT_FAMILIES}; pass {@link ALL_WORD_DEFAULT_FAMILIES} to
   * add the families this package substitutes for that Word does not apply by default.
   */
  readonly families?: readonly WordDefaultFamily[];
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
}

const manifestByFile = new Map(FONT_ASSET_MANIFEST.map((entry) => [entry.file, entry]));

/** Bundler-visible asset URL for one packaged face. */
const assetUrl = (file: string): URL => FONT_ASSET_URLS[file];

/**
 * The families Word applies to a document by DEFAULT, and what
 * {@link LoadDefaultFontsOptions.families} falls back to. Frozen — treat it as a constant
 * rather than a mutable list to filter in place.
 *
 * This is the load-every-document set, so it stays as small as correctness allows: a
 * family here costs four faces on every load, whether or not the file names it.
 */
export const WORD_DOCUMENT_DEFAULT_FAMILIES: readonly WordDefaultFamily[] = Object.freeze([
  'Calibri',
  'Cambria',
  'Times New Roman',
  'Arial',
  'Courier New',
]);

/**
 * Every Word family this package substitutes for, including the ones Word does not apply
 * by default. NOT the default for {@link LoadDefaultFontsOptions.families} — pass it
 * explicitly to load them all:
 *
 * ```ts
 * const fonts = await defaultFonts({ families: ALL_WORD_DEFAULT_FAMILIES });
 * ```
 *
 * {@link packagedFonts} covers the extra families on demand instead, so a document that
 * never names Century Gothic never pays for its assets — from these same bundled bytes,
 * with no network involved. `googleFonts()` covers them too, for an app already opted into
 * the catalog.
 */
export const ALL_WORD_DEFAULT_FAMILIES: readonly WordDefaultFamily[] = Object.freeze([
  ...WORD_DOCUMENT_DEFAULT_FAMILIES,
  'Century Gothic',
]);

/**
 * Source id for a packaged file. Built here and parsed by {@link installDefaultFontFaces}
 * to find bytes it would otherwise refetch, so the two must not drift; keeping both sides
 * in one place is what stops them.
 */
const SOURCE_ID_PREFIX = 'default-fonts:';
const sourceIdForFile = (file: string): string => `${SOURCE_ID_PREFIX}${file}`;
const fileFromSourceId = (id: string): string | undefined =>
  id.startsWith(SOURCE_ID_PREFIX) ? id.slice(SOURCE_ID_PREFIX.length) : undefined;

/**
 * Load the packaged substitute faces for the given Word families
 * ({@link WORD_DOCUMENT_DEFAULT_FAMILIES} by default) and return a configuration
 * fragment: byte-backed sources for the SUBSTITUTE families plus the Word-name →
 * substitute substitution map, so a document naming "Calibri" resolves without the host
 * mapping anything.
 *
 * Only the requested families' assets are fetched, in parallel. A face that fails to
 * load appears in `failures` and the rest of the fragment stays usable — compose it
 * anyway and the missing face measures via the engine's fixed fallback.
 */
export async function loadDefaultFonts(
  options: LoadDefaultFontsOptions = {}
): Promise<DefaultFontsFragment> {
  const families = options.families ?? WORD_DOCUMENT_DEFAULT_FAMILIES;
  const fetcher = options.fetcher ?? fetch;

  const sources: DefaultFontSource[] = [];
  const substitutions: DefaultFontSubstitution[] = [];
  const failures: DefaultFontLoadFailure[] = [];

  const jobs: Promise<void>[] = [];
  for (const family of families) {
    const plan = FAMILY_PLANS.get(family);
    if (!plan) continue; // Unknown name: nothing to stand in for.
    for (const face of FACES) {
      const file = planFaceFile(plan, face.suffix);
      const manifest = manifestByFile.get(file);
      if (!manifest) {
        failures.push({ family, file, diagnostic: 'face missing from packaged manifest' });
        continue;
      }
      const lineMetrics = planLineBox(plan, face.weight);
      substitutions.push({
        from: { family, weight: face.weight, style: face.style },
        to: { family: plan.substitute, weight: face.weight, style: face.style },
        ...(lineMetrics ? { lineMetrics } : {}),
      });
      jobs.push(
        (async () => {
          try {
            const response = await fetcher(assetUrl(file) as unknown as RequestInfo);
            if (!response.ok) {
              failures.push({ family, file, diagnostic: `HTTP ${response.status}` });
              return;
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength !== manifest.byteLength) {
              failures.push({
                family,
                file,
                diagnostic: `unexpected byte length ${bytes.byteLength}, packaged ${manifest.byteLength}`,
              });
              return;
            }
            sources.push({
              request: { family: plan.substitute, weight: face.weight, style: face.style },
              id: sourceIdForFile(file),
              bytes,
              // Baked at packaging time and CI-verified; the engine's admission path
              // re-derives and compares, so a swapped asset still fails loudly there.
              hash: manifest.hash,
              faceIndex: 0,
            });
          } catch (error) {
            failures.push({
              family,
              file,
              diagnostic: error instanceof Error ? error.message : String(error),
            });
          }
        })()
      );
    }
  }
  await Promise.all(jobs);

  // Deterministic order regardless of fetch completion, so composed configurations
  // fingerprint stably across loads.
  sources.sort((a, b) => a.id.localeCompare(b.id));
  return { sources, substitutions, failures };
}

/**
 * Registration starts already made per FontFaceSet, so overlapping calls (React
 * StrictMode's double effect is the concrete trigger) neither double-register nor
 * double-fetch: the synchronous `[...fontSet]` check cannot see a face whose async
 * `load()` has not resolved yet.
 */
const startedInstalls = new WeakMap<FontFaceSet, Set<string>>();

/**
 * OPTIONAL paint-side fidelity: register the packaged substitutes with the browser's
 * `FontFace` API under the WORD family names, so painted glyphs use the same metrics
 * layout measured with instead of whatever the platform substitutes for "Calibri".
 * Presentation-only, app-triggered, idempotent per document (overlapping calls
 * included); returns the number of faces registered. No-op outside a DOM environment.
 *
 * NOT a substitute for {@link loadDefaultFonts}. This affects painting only — calling it
 * alone leaves the engine measuring on the fixed fallback, which looks right and
 * paginates wrong. Pair it with `loadDefaultFonts()` fed to the editor's `fonts` prop.
 *
 * The return value counts faces THIS call registered, so `0` covers "no DOM
 * environment", "already registered", and "every face failed" alike; treat it as a
 * diagnostic hint rather than a success signal.
 */
export async function installDefaultFontFaces(
  options: LoadDefaultFontsOptions & {
    readonly document?: Document;
    /**
     * Sources {@link loadDefaultFonts} already produced. A face found here registers from
     * those bytes; anything missing still registers by URL, so a standalone call with no
     * loader behind it behaves exactly as before.
     */
    readonly loaded?: readonly DefaultFontSource[];
  } = {}
): Promise<number> {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  const fontSet = (doc as { fonts?: FontFaceSet } | undefined)?.fonts;
  if (!doc || !fontSet || typeof FontFace === 'undefined') return 0;
  const preloaded = new Map<string, Uint8Array>();
  for (const source of options.loaded ?? []) {
    const file = fileFromSourceId(source.id);
    if (file !== undefined) preloaded.set(file, source.bytes);
  }
  let started = startedInstalls.get(fontSet);
  if (!started) {
    started = new Set();
    startedInstalls.set(fontSet, started);
  }
  const families = options.families ?? WORD_DOCUMENT_DEFAULT_FAMILIES;
  let installed = 0;
  const jobs: Promise<void>[] = [];
  for (const family of families) {
    const plan = FAMILY_PLANS.get(family);
    if (!plan) continue;
    for (const face of FACES) {
      const file = planFaceFile(plan, face.suffix);
      if (!manifestByFile.has(file)) continue;
      const faceKey = `${family}#${face.weight}#${face.style}`;
      if (started.has(faceKey)) continue;
      const already = [...fontSet].some(
        (existing) =>
          existing.family === family &&
          existing.weight === String(face.weight) &&
          existing.style === face.style
      );
      if (already) continue;
      started.add(faceKey);
      jobs.push(
        (async () => {
          try {
            const bytes = preloaded.get(file);
            // A copy. These exact buffers also go to the engine as `FontSource.bytes` and
            // get shaped there, so handing the original to the browser's font machinery
            // would share one ArrayBuffer between the two. Unlike the engine's own
            // registration, this is not guarding a windowed view — `bytes` is always a
            // fresh full-length array — it is keeping the two consumers unaliased.
            //
            // No bytes means the face failed to load, and the URL form still registers it.
            // That request is the one `fetcher` cannot intercept.
            const source: string | ArrayBuffer = bytes
              ? (bytes.slice().buffer as ArrayBuffer)
              : `url(${assetUrl(file).href})`;
            const fontFace = new FontFace(family, source, {
              weight: String(face.weight),
              style: face.style,
            });
            await fontFace.load();
            fontSet.add(fontFace);
            installed += 1;
          } catch {
            // Paint fidelity is best-effort; measurement does not depend on it.
          }
        })()
      );
    }
  }
  await Promise.all(jobs);
  return installed;
}

/**
 * The whole default-font boot, in one call: load the bytes, register the paint-side faces,
 * and hand back the fragment for the editor's `fonts` prop.
 *
 * The two halves have to happen together and almost nobody wants them apart —
 * {@link loadDefaultFonts} alone measures correctly and paints with whatever the platform
 * substitutes; {@link installDefaultFontFaces} alone paints correctly and paginates wrong.
 * Every host was writing the same six lines to pair them, so this is that pairing.
 *
 * Failures are WARNED, not thrown: a face that will not load degrades that one family to
 * fixed-width measurement, which is a worse-looking document rather than no document. Pass
 * `onFailure` to route them somewhere other than the console.
 */
export async function defaultFonts(
  options: LoadDefaultFontsOptions & {
    readonly onFailure?: (failure: DefaultFontLoadFailure) => void;
  } = {}
): Promise<DefaultFontsFragment> {
  const { onFailure, ...loadOptions } = options;
  const fragment = await loadDefaultFonts(loadOptions);
  for (const failure of fragment.failures) {
    if (onFailure) onFailure(failure);
    else console.warn(`[fonts] ${failure.family} (${failure.file}): ${failure.diagnostic}`);
  }
  // Not awaited: painting can start on the platform's substitute and swap when the real
  // face arrives, and blocking the document on it would delay first paint for nothing.
  // The fragment goes with it, so registration reuses these bytes rather than asking the
  // browser to fetch each face a second time.
  void installDefaultFontFaces({ ...loadOptions, loaded: fragment.sources });
  return fragment;
}

/**
 * The mark that tells `useDocxSource` a function is an on-demand resolver rather than a
 * zero-argument loader. `Symbol.for` of the same key `@docx-editor.dev/core`'s
 * `defineFontResolver` uses.
 *
 * Written out here rather than imported, for the same reason the face types above are
 * structural copies: this package has no runtime or type dependency on the engine, so a
 * host can install font bytes without installing an editor. A registered symbol is
 * identical across module copies, so both spellings produce the same mark.
 */
const FONT_RESOLVER_BRAND: unique symbol = Symbol.for('docx-editor.dev/font-resolver') as never;

/** The string half of the same mark; see {@link FontResolverMark}. */
const FONT_RESOLVER_MARK_KEY = 'docx-editor.dev/font-resolver';

/**
 * The TYPE-level half of the resolver mark, structurally identical to the editor
 * contract's `FontResolverMark`.
 *
 * A string key rather than a symbol precisely so the two unify without this package
 * importing anything from the engine: two `unique symbol` declarations in two packages are
 * two different types. Because they unify, `useFonts(packagedFonts())` typechecks against
 * a `FontOrigin` list that REQUIRES the mark, and a hand-written resolver that forgot
 * `defineFontResolver` does not.
 */
export interface FontResolverMark {
  /** Always `true`. Set non-enumerably on the resolvers this package builds. */
  readonly 'docx-editor.dev/font-resolver': true;
}

/** Set both halves of the mark on a resolver, non-enumerably. */
function markResolver<T extends object>(resolve: T): T & FontResolverMark {
  const descriptor = { value: true, enumerable: false, configurable: true } as const;
  Object.defineProperty(resolve, FONT_RESOLVER_BRAND, descriptor);
  Object.defineProperty(resolve, FONT_RESOLVER_MARK_KEY, descriptor);
  return resolve as T & FontResolverMark;
}

/**
 * One face an earlier origin can already paint, structurally identical to the editor
 * contract's `FontFaceRequest`.
 */
export interface ResolvedFontFace {
  /** The family name, matched case-insensitively as Word matches font names. */
  readonly family: string;
  /** CSS numeric weight; the packaged faces are 400 and 700. */
  readonly weight: number;
  /** Whether this is the upright or the italic face. */
  readonly style: 'normal' | 'italic';
}

/**
 * The request both resolvers in this package take, structurally identical to the editor
 * contract's `FontResolutionRequest`.
 *
 * Named rather than written inline at each call site so a mismatch reports one line rather
 * than a four-line structural wall.
 *
 * @public
 */
export interface FontOriginRequest {
  /** Families the document declares, already name-validated and capped by the engine. */
  readonly families: readonly string[];
  /** The face a run naming no font resolves to. The engine reports Calibri by default. */
  readonly defaultFamily: string;
  /** Faces an earlier origin in the same composition can already paint. */
  readonly resolvedFaces?: readonly ResolvedFontFace[];
}

/** Case-folded face identity, matching how the engine keys `resolvedFaces`. */
const faceKey = (family: string, weight: number, style: string): string =>
  `${family.trim().toLowerCase()} ${weight} ${style}`;

/**
 * How {@link packagedFonts} behaves once a document hands it a family list. Every field is
 * optional; `packagedFonts()` with no options serves any of the six families a document
 * names, over the global `fetch`, warning to the console on failure.
 */
export interface PackagedFontsOptions {
  /**
   * Narrow what may ever be loaded. Omitted, any of the six substituted families a
   * document names is fair game — {@link ALL_WORD_DEFAULT_FAMILIES}, not the smaller set
   * the eager loader defaults to. Set it to run against a shorter list.
   */
  readonly allow?: readonly WordDefaultFamily[];
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
  /** Per-face failures. Defaults to a console warning; pass a handler to route them. */
  readonly onFailure?: (failure: DefaultFontLoadFailure) => void;
  /**
   * Set `false` to skip the paint-side `FontFace` registration
   * {@link installDefaultFontFaces} performs. Measurement is unaffected; painted glyphs
   * fall back to whatever the platform substitutes for the Word family name.
   *
   * Registration reuses the bytes the resolver already loaded, so a face that loaded costs
   * no second request and {@link PackagedFontsOptions.fetcher} sees every byte read for it.
   * A face that FAILED to load has no bytes to reuse and still registers by URL, which
   * `fetcher` cannot intercept. The registration is idempotent per document.
   */
  readonly install?: boolean;
}

/**
 * What {@link packagedFonts} returns: a marked resolver over the packaged substitutes.
 *
 * @public
 */
export type PackagedFontsResolver = ((
  request: FontOriginRequest
) => Promise<PackagedFontsFragment>) &
  FontResolverMark;

/** What one {@link packagedFonts} resolver call produced. */
export interface PackagedFontsFragment extends DefaultFontsFragment {
  /** The Word families this call actually loaded, in {@link ALL_WORD_DEFAULT_FAMILIES} order. */
  readonly families: readonly WordDefaultFamily[];
}

/**
 * Case-folded Word family name -> the canonical spelling, built once.
 *
 * ALL six, deliberately, not the five in {@link WORD_DOCUMENT_DEFAULT_FAMILIES}. Those two
 * lists exist because the eager loader pays for a family on EVERY load, so the set it
 * defaults to stays as small as correctness allows. This resolver has the opposite cost
 * shape: a family it can serve costs nothing until a document names it. Century Gothic is
 * the family that distinction was drawn for, and serving it here is the same on-demand
 * bargain {@link ALL_WORD_DEFAULT_FAMILIES} points at — from bundled bytes, with no third
 * party involved.
 */
const wordFamiliesByFoldedName: ReadonlyMap<string, WordDefaultFamily> = new Map(
  ALL_WORD_DEFAULT_FAMILIES.map((family) => [family.toLowerCase(), family] as const)
);

/**
 * The packaged substitutes, served ON DEMAND: an editor-shaped font resolver that loads
 * the families a document turns out to name, plus its default face, rather than every
 * family this package ships.
 *
 * Same call shape as `googleFonts()` from `@docx-editor.dev/fonts/google`, so the two
 * compose by sitting next to each other rather than by being combined differently:
 *
 * ```ts
 * const fonts = useFonts(packagedFonts());                  // bundled faces only
 * const fonts = useFonts(packagedFonts(), googleFonts());   // and the Google catalog
 * ```
 *
 * Prefer this to {@link defaultFonts} unless you need the eager guarantee. `defaultFonts()`
 * loads all 20 faces of {@link WORD_DOCUMENT_DEFAULT_FAMILIES} — 7.4 MB — whichever
 * document opens, because it is called before there is a document to ask. This is called
 * AFTER the parse, so a file using only Times New Roman costs Liberation Serif plus the
 * four Carlito faces instead.
 *
 * A family loads when a document NAMES it, or when it is that document's DEFAULT face. The
 * default counts because a run that authors no font still has to be measured in one. The
 * engine reports Calibri as the default, so Carlito is a floor here: even a document
 * naming none of the six loads it. Narrow that with {@link PackagedFontsOptions.allow} if a
 * document's families are known in advance.
 *
 * What you trade for that is one reflow. The eager form settles before the first layout, so
 * the document paginates once; this form cannot know the families until the file is parsed,
 * so the document opens on the engine's fixed measurer and re-paginates when the faces
 * arrive. Nothing is fetched from a third party either way — the bytes are the ones inside
 * this package.
 *
 * The families are file-derived, so they are matched case-insensitively against the closed
 * {@link ALL_WORD_DEFAULT_FAMILIES} list and never used to build a path. A name outside it
 * resolves to nothing here; pair with `googleFonts()` to cover more.
 */
export function packagedFonts(options: PackagedFontsOptions = {}): PackagedFontsResolver {
  const allowed = options.allow
    ? new Set(options.allow.map((family) => family.toLowerCase()))
    : null;

  async function resolvePackagedFonts(request: FontOriginRequest): Promise<PackagedFontsFragment> {
    // Faces an earlier origin in the composition can already PAINT. Loading them again
    // would spend the bytes on a fragment first-wins composition is bound to drop.
    const already = new Set(
      (request.resolvedFaces ?? []).map((face) => faceKey(face.family, face.weight, face.style))
    );
    // ALL FOUR faces, or none. This loads a family at a time, so skipping one whose
    // regular is covered but whose bold is not would leave the bold with neither bytes nor
    // a substitution — which is exactly what the family-grained version of this check did.
    const fullyCovered = (family: WordDefaultFamily): boolean => {
      const substitute = FAMILY_PLANS.get(family)!.substitute;
      return FACES.every(
        // Under the Word name the document wrote, or under the face this would load: an
        // earlier origin may have reported either.
        (face) =>
          already.has(faceKey(family, face.weight, face.style)) ||
          already.has(faceKey(substitute, face.weight, face.style))
      );
    };
    // The default family counts as declared: a document whose runs name no font still
    // renders in one, and leaving it out would load nothing for a file that is entirely
    // default-styled.
    const wanted = new Set<WordDefaultFamily>();
    for (const declared of [request.defaultFamily, ...request.families]) {
      const family = wordFamiliesByFoldedName.get(declared.toLowerCase());
      if (!family) continue;
      if (allowed && !allowed.has(family.toLowerCase())) continue;
      if (fullyCovered(family)) continue;
      wanted.add(family);
    }
    // Stable order regardless of how the document happened to declare them, so the same
    // file composes to the same configuration on every load.
    const families = ALL_WORD_DEFAULT_FAMILIES.filter((family) => wanted.has(family));
    if (families.length === 0) return { sources: [], substitutions: [], failures: [], families };

    const loadOptions = {
      families,
      ...(options.fetcher ? { fetcher: options.fetcher } : {}),
    };
    const fragment = await loadDefaultFonts(loadOptions);
    for (const failure of fragment.failures) {
      if (options.onFailure) options.onFailure(failure);
      else console.warn(`[fonts] ${failure.family} (${failure.file}): ${failure.diagnostic}`);
    }
    // Not awaited, exactly as in `defaultFonts`: painting can start on the platform's
    // substitute and swap when the real face arrives.
    if (options.install !== false) {
      void installDefaultFontFaces({ ...loadOptions, loaded: fragment.sources });
    }
    return { ...fragment, families };
  }

  return markResolver(resolvePackagedFonts);
}

export { FONT_ASSET_MANIFEST, type FontAssetManifestEntry } from './manifest.generated.ts';
