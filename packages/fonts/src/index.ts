/**
 * `@docx-editor.dev/fonts` — metric-compatible substitutes for common Word faces.
 *
 * Word's own defaults (Calibri, Cambria, Times New Roman, Arial, Courier New) are proprietary
 * and cannot ship in an open package. What CAN ship are the faces built to MATCH THEIR METRICS:
 * matching advance widths for the glyphs they cover, though outlines differ slightly.
 * Scripts outside that coverage still need a suitable native or app-supplied font.
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
// MATCH THEIR METRICS for the glyphs they cover. Scripts outside that coverage still
// need a suitable native or app-supplied font:
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

import {
  FACES,
  FAMILY_PLANS,
  facesNeeded,
  packagedFaces,
  planFaceFile,
  planLineBox,
  planSourceFace,
  uncoveredFaces,
} from './family-plans.ts';
import type { DefaultFontFamily, FamilyPlan } from './family-plans.ts';
import { packagedAssetRootOverride, resolvePackagedAssetRoot } from './asset-root.ts';
import { FONT_ASSET_MANIFEST, FONT_ASSET_URLS } from './manifest.generated.ts';
import { canIdle, fetchFontFile, idle } from './byte-cache.ts';
import { OWN_NAME_FAMILIES, ownNameFacesFor } from './own-name-faces.ts';

export { GLYPH_FALLBACK_FACE_FAMILIES } from './own-name-faces.ts';

export type { DefaultFontFamily } from './family-plans.ts';

/** @deprecated Use {@link DefaultFontFamily}. */
export type WordDefaultFamily = DefaultFontFamily;

/** A concrete font face request, structurally identical to the editor contract's. */
export interface DefaultFontFaceRequest {
  readonly family: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}

/**
 * How a font loader loads the faces of each family: `'progressive'` (the default), `'eager'`, or
 * `'lazy'`. See {@link PackagedFontsOptions.loading}.
 *
 * @public
 */
export type FontLoading = 'progressive' | 'eager' | 'lazy';

/** One face of a family, by weight and style. */
export interface DefaultFontStyle {
  /** CSS numeric weight. The packaged faces are 400 and 700: 600 or more selects 700. */
  readonly weight: number;
  /** Whether this is the upright or the italic face. */
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
 * Options shared by {@link loadDefaultFonts} and {@link defaultFonts}.
 * All fields are optional, so `{}` loads
 * {@link DEFAULT_FONT_FAMILIES} over the global `fetch`.
 */
export interface LoadDefaultFontsOptions {
  /**
   * Narrow or widen the families to load. The default is
   * {@link DEFAULT_FONT_FAMILIES}; pass {@link ALL_DEFAULT_FONT_FAMILIES} to
   * add the families this package substitutes for that Word does not apply by default.
   */
  readonly families?: readonly DefaultFontFamily[];
  /**
   * The faces to load of each family, by weight and style. A weight of 600 or more selects
   * the bold face, and a lower weight the regular face. Omitted, all four faces load:
   * regular, bold, italic, and bold italic. The fragment maps only the faces it loads.
   */
  readonly faces?: readonly DefaultFontStyle[];
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
  /**
   * Cancels outstanding reads in `loadDefaultFonts` and `defaultFonts`. Cancellation rejects with
   * `signal.reason`; it is not reported as one failure per face and does not call `onFailure`.
   */
  readonly signal?: AbortSignal;
}

const manifestByFile = new Map(FONT_ASSET_MANIFEST.map((entry) => [entry.file, entry]));

/**
 * Bundler-visible asset location for one packaged face.
 *
 * The return type is `URL | string` because bundlers disagree, and the disagreement is
 * not observable from this file. Node, Bun, and Vite leave the `new URL(literal,
 * import.meta.url)` expression as a real `URL`. webpack and Turbopack replace the whole
 * expression with a bare path STRING for the asset they emitted, such as
 * `/_next/static/media/Caladea-Bold.d6e01b80.ttf`. Anything that needs a `URL` here has
 * to cope with both; see {@link FONT_ASSET_ROOT}.
 */
const relocatedAssetRoot = packagedAssetRootOverride();
const assetUrl = (file: string): URL | string =>
  relocatedAssetRoot === undefined ? FONT_ASSET_URLS[file]! : new URL(file, relocatedAssetRoot);

/**
 * Directory URL of the packaged font files this package serves.
 *
 * Headless exporters pass this to Core `createPackagedFileFetch` as `trustedRoot`.
 * The value comes from the same packaged face URLs the loaders fetch, so the trusted
 * directory matches Node, Bun, pnpm, Yarn PnP, and nested installs.
 *
 * In a browser bundle this resolves to an HTTP URL rather than a `file:` one. That is
 * why every consumer gates on `FONT_ASSET_ROOT.protocol === 'file:'`: HTTP fetches do
 * not use a trusted directory, and confining them to one would be meaningless.
 *
 * Deriving this MUST NOT throw. It runs at module scope, so a throw here is
 * uncatchable and takes down the whole bundle that imported this package rather than
 * degrading font loading.
 *
 * In Node, the `DOCX_EDITOR_FONT_ASSET_ROOT` environment variable relocates this
 * directory. Single-file bundles set it to a copy of the package's `assets/` directory
 * that ships beside the executable, and every packaged face is then read from there.
 *
 * @public
 */
export const FONT_ASSET_ROOT: URL =
  relocatedAssetRoot ?? resolvePackagedAssetRoot(assetUrl(FONT_ASSET_MANIFEST[0]!.file));

/**
 * The families Word applies to a document by DEFAULT, and what
 * {@link LoadDefaultFontsOptions.families} falls back to. Frozen — treat it as a constant
 * rather than a mutable list to filter in place.
 *
 * This is the load-every-document set, so it stays as small as correctness allows: a
 * family here costs four faces on every load, whether or not the file names it.
 */
export const DEFAULT_FONT_FAMILIES: readonly DefaultFontFamily[] = Object.freeze([
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
 * const fonts = await defaultFonts({ families: ALL_DEFAULT_FONT_FAMILIES });
 * ```
 *
 * {@link packagedFonts} covers the extra families on demand instead, so a document that
 * never names Century Gothic never pays for its assets — from these same bundled bytes,
 * with no network involved. `googleFonts()` covers them too, for an app already opted into
 * the catalog.
 */
export const ALL_DEFAULT_FONT_FAMILIES: readonly DefaultFontFamily[] = Object.freeze([
  ...DEFAULT_FONT_FAMILIES,
  'Century Gothic',
  'Segoe UI',
]);

/** @deprecated Use {@link DEFAULT_FONT_FAMILIES}. */
export const WORD_DOCUMENT_DEFAULT_FAMILIES: readonly DefaultFontFamily[] = DEFAULT_FONT_FAMILIES;

/** @deprecated Use {@link ALL_DEFAULT_FONT_FAMILIES}. */
export const ALL_WORD_DEFAULT_FAMILIES: readonly DefaultFontFamily[] = ALL_DEFAULT_FONT_FAMILIES;

/** Stable source id for a packaged file. */
const sourceIdForFile = (file: string): string => `default-fonts:${file}`;

/**
 * Load the packaged substitute faces for the given Word families
 * ({@link DEFAULT_FONT_FAMILIES} by default) and return a configuration
 * fragment: byte-backed sources for the SUBSTITUTE families plus the Word-name →
 * substitute substitution map, so a document naming "Calibri" resolves without the host
 * mapping anything.
 *
 * Only the requested families' assets are fetched, in parallel. Fetched bytes stay in memory
 * for later calls with the same `fetcher`, and calls share one `Uint8Array` for each file. Do
 * not change or transfer these bytes: copy them first. A face that fails to
 * load appears in `failures` and the rest of the fragment stays usable — compose it
 * anyway and the missing face measures via the engine's fixed fallback. Caller cancellation is
 * different: the promise rejects with `signal.reason` and returns no partial failure report.
 */
export async function loadDefaultFonts(
  options: LoadDefaultFontsOptions = {}
): Promise<DefaultFontsFragment> {
  const families = options.families ?? DEFAULT_FONT_FAMILIES;
  const faces = options.faces ? packagedFaces(options.faces) : FACES;
  return loadPackagedFaces(
    families.map((family) => ({ family, faces })),
    options.fetcher ?? fetch,
    options.signal
  );
}

/** The packaged file of each face to load, with its family and manifest entry. */
function packagedFiles(
  entries: readonly { family: DefaultFontFamily; faces: readonly (typeof FACES)[number][] }[]
): { family: DefaultFontFamily; file: string; face: (typeof FACES)[number] }[] {
  const files = new Map<
    string,
    { family: DefaultFontFamily; file: string; face: (typeof FACES)[number] }
  >();
  for (const { family, faces } of entries) {
    const plan = FAMILY_PLANS.get(family);
    if (!plan) continue;
    for (const face of faces) {
      // An italic served by its upright twin loads the upright file.
      const source = planSourceFace(plan, face);
      const file = planFaceFile(plan, source.suffix);
      if (!files.has(file)) files.set(file, { family, file, face: source });
    }
  }
  return [...files.values()];
}

/**
 * Load `faces` of each family: the shared engine of {@link loadDefaultFonts} and
 * {@link packagedFonts}. Bytes come from the shared byte cache (`byte-cache.ts`), or from
 * the network.
 */
async function loadPackagedFaces(
  entries: readonly { family: DefaultFontFamily; faces: readonly (typeof FACES)[number][] }[],
  fetcher: typeof fetch,
  signal: AbortSignal | undefined,
  low = false
): Promise<DefaultFontsFragment> {
  const sources: DefaultFontSource[] = [];
  const substitutions: DefaultFontSubstitution[] = [];
  const failures: DefaultFontLoadFailure[] = [];
  const failedFiles = new Set<string>();

  const jobs = packagedFiles(entries).map(async ({ family, file, face }) => {
    const manifest = manifestByFile.get(file);
    if (!manifest) {
      failures.push({ family, file, diagnostic: 'face missing from packaged manifest' });
      failedFiles.add(file);
      return;
    }
    try {
      const bytes = await fetchFontFile(
        { url: assetUrl(file), byteLength: manifest.byteLength, source: 'packaged' },
        fetcher,
        signal,
        false,
        low
      );
      sources.push({
        request: {
          family: FAMILY_PLANS.get(family)!.substitute,
          weight: face.weight,
          style: face.style,
        },
        id: sourceIdForFile(file),
        bytes,
        // Baked at packaging time and CI-verified; the engine's admission path
        // re-derives and compares, so a swapped asset still fails loudly there.
        hash: manifest.hash,
        faceIndex: 0,
      });
    } catch (error) {
      // Cancellation belongs to the caller's operation, not to any individual face.
      // Propagate it so superseded exports do not report every concurrent fetch as a
      // separate font failure (or seed a partial fragment from an abandoned load).
      if (signal?.aborted) throw signal.reason ?? error;
      failedFiles.add(file);
      failures.push({
        family,
        file,
        diagnostic: error instanceof Error ? error.message : String(error),
      });
    }
  });
  await Promise.all(jobs);

  for (const { family, faces } of entries) {
    const plan = FAMILY_PLANS.get(family);
    if (!plan) continue;
    for (const face of faces) {
      const source = planSourceFace(plan, face);
      if (!manifestByFile.has(planFaceFile(plan, source.suffix))) continue;
      const lineMetrics = planLineBox(plan, face.weight);
      substitutions.push({
        from: { family, weight: face.weight, style: face.style },
        to: { family: plan.substitute, weight: source.weight, style: source.style },
        ...(lineMetrics ? { lineMetrics } : {}),
      });
    }
  }
  // Deterministic order regardless of fetch completion, so composed configurations
  // fingerprint stably across loads.
  sources.sort((a, b) => a.id.localeCompare(b.id));
  return { sources, substitutions, failures };
}

/**
 * Compatibility stub for the removed page-wide font installer.
 *
 * @deprecated Does nothing and resolves to `0`. It does not fetch or register fonts.
 * Remove this call. Supply {@link defaultFonts} or {@link packagedFonts} through the
 * editor's `fonts` option for private font registration.
 */
export async function installDefaultFontFaces(
  _options: LoadDefaultFontsOptions & {
    readonly document?: Document;
    readonly loaded?: readonly DefaultFontSource[];
  } = {}
): Promise<number> {
  return 0;
}

/**
 * Load the default-font bytes and report failures for the editor's `fonts` prop.
 *
 * The editor registers these bytes under private aliases for measurement and paint.
 * This loader leaves public CSS family names unchanged, so native fonts remain available
 * when a packaged substitute lacks a script.
 *
 * Non-cancellation face failures are WARNED, not thrown: one unavailable face degrades that
 * family to fixed-width measurement rather than refusing the document. Pass `onFailure` to route
 * them somewhere other than the console. Caller cancellation rejects with `signal.reason` before
 * any per-face warnings or callbacks are produced.
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
  // Core owns private face registration. A public Arial→Liberation Sans registration
  // hides native Arial's Arabic glyphs, which Liberation Sans does not contain.
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
 * One face of a family, structurally identical to the editor contract's `FontFaceRequest`.
 * {@link FontOriginRequest.resolvedFaces} uses it for faces an earlier origin can already
 * paint, and {@link FontOriginRequest.faces} for faces the document's text uses.
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
  /**
   * Cancels document-scoped resolution. `packagedFonts` rejects with `signal.reason` and does not
   * translate cancellation into per-face failures or `onFailure` callbacks.
   */
  readonly signal?: AbortSignal;
  /** Faces an earlier origin in the same composition can already paint. */
  readonly resolvedFaces?: readonly ResolvedFontFace[];
  /**
   * The faces the document's text uses. When present, the resolvers in this package load only
   * these faces. The engine asks again when text starts to use another face. Absent, they load
   * every face of each family they serve.
   */
  readonly faces?: readonly ResolvedFontFace[];
}

/**
 * Map `face` of the name `from` onto the face that paints it: `to` under the same weight and
 * style, or the packaged substitute of `plan`, with the substitute's line box.
 */
function aliasSubstitution(
  from: string,
  plan: FamilyPlan,
  face: (typeof FACES)[number],
  to?: string
): DefaultFontSubstitution {
  const source = to ? face : planSourceFace(plan, face);
  const lineMetrics = planLineBox(plan, face.weight);
  return {
    from: { family: from, weight: face.weight, style: face.style },
    to: { family: to ?? plan.substitute, weight: source.weight, style: source.style },
    ...(lineMetrics ? { lineMetrics } : {}),
  };
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
   * document names is fair game — {@link ALL_DEFAULT_FONT_FAMILIES}, not the smaller set
   * the eager loader defaults to. Set it to run against a shorter list. An alias served from
   * a family's bytes ({@link PACKAGED_FAMILY_ALIASES}, such as Helvetica) follows that family.
   */
  readonly allow?: readonly DefaultFontFamily[];
  /**
   * Whether to serve the glyph fallback faces ({@link GLYPH_FALLBACK_FACE_FAMILIES}): symbols,
   * mathematics, Arabic, and emoji. The editor asks for one by name when the text holds a
   * character that its own font lacks, and each loads only then. Defaults to `true`. With
   * `false`, such a character draws in whatever font the browser picks, and its line can differ
   * from PDF export.
   */
  readonly fallbackFaces?: boolean;
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
  /**
   * Non-cancellation per-face failures. Defaults to a console warning; pass a handler to route
   * them. Caller cancellation rejects the resolver without invoking this callback.
   */
  readonly onFailure?: (failure: DefaultFontLoadFailure) => void;
  /**
   * How the faces of each font family load. A family has up to four faces: regular, bold,
   * italic, and bold italic. The text shows with estimated measurements until its fonts arrive.
   *
   * - `'progressive'` (default): the text switches to its own fonts when the faces it uses
   *   arrive. The other faces of the same families then load in the background, when the
   *   browser is idle, and install in one step ({@link PackagedFontsFragment.deferred}). A later bold
   *   or italic edit needs no download. Outside a browser, the other faces load when text
   *   first uses them.
   * - `'eager'`: the text switches to its own fonts when every face of its families arrives.
   * - `'lazy'`: only the faces the text uses load. Another face loads when text first uses
   *   it, and the text lays out again when it arrives.
   */
  readonly loading?: FontLoading;
  /**
   * Legacy registration option, retained for source compatibility.
   *
   * @deprecated Ignored. Font registration is always private to the editor.
   * Remove this option; `true` no longer enables page-wide registration.
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
  /**
   * Families this provider can serve, including faces not loaded by this request and
   * aliases served from a packaged family's bytes, such as Helvetica.
   */
  readonly supportedFamilies?: readonly string[];
  /** The Word families this call actually loaded, in {@link ALL_DEFAULT_FONT_FAMILIES} order. */
  readonly families: readonly DefaultFontFamily[];
  /**
   * The other faces of the families in use, settled after they load in the background
   * ({@link PackagedFontsOptions.loading}). The editor installs them when they arrive.
   */
  readonly deferred?: Promise<PackagedFontsFragment>;
}

/**
 * Case-folded Word family name -> the canonical spelling, built once.
 *
 * ALL six, deliberately, not the five in {@link DEFAULT_FONT_FAMILIES}. Those two
 * lists exist because the eager loader pays for a family on EVERY load, so the set it
 * defaults to stays as small as correctness allows. This resolver has the opposite cost
 * shape: a family it can serve costs nothing until a document names it. Century Gothic is
 * the family that distinction was drawn for, and serving it here is the same on-demand
 * bargain {@link ALL_DEFAULT_FONT_FAMILIES} points at — from bundled bytes, with no third
 * party involved.
 */
const wordFamiliesByFoldedName: ReadonlyMap<string, DefaultFontFamily> = new Map(
  ALL_DEFAULT_FONT_FAMILIES.map((family) => [family.toLowerCase(), family] as const)
);

/**
 * Families with the same advance widths as a packaged family, served from its bytes under
 * their own name, each mapped to that family. Helvetica and Arial share every advance width,
 * so Liberation Sans stands in for both. Documents match these names case-insensitively.
 *
 * @public
 */
export const PACKAGED_FAMILY_ALIASES: Readonly<Record<string, DefaultFontFamily>> = Object.freeze({
  Helvetica: 'Arial',
});

/** {@link PACKAGED_FAMILY_ALIASES} by case-folded name; a `Map`, as the key is file-derived. */
const aliasesByFoldedName: ReadonlyMap<string, DefaultFontFamily> = new Map(
  Object.entries(PACKAGED_FAMILY_ALIASES).map(([alias, family]) => [alias.toLowerCase(), family])
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
 * loads all 20 faces of {@link DEFAULT_FONT_FAMILIES} — 7.4 MB — whichever
 * document opens, because it is called before there is a document to ask. This is called
 * AFTER the parse, and the editor names the faces that the laid-out text uses
 * ({@link FontOriginRequest.faces}). A file whose text is only regular Times New Roman shows
 * after one Liberation Serif face arrives. The other faces of the families in use then load in
 * the background and install in one step (see {@link PackagedFontsOptions.loading}), so a
 * later bold or italic edit needs no download. A face of a family that no text used before,
 * such as a font picked in the toolbar, loads when the editor asks for it.
 *
 * A request without `faces` loads every face of each family that the document NAMES, and of
 * its DEFAULT family. The default counts because a run that authors no font still has to be
 * measured in one. Narrow the families with {@link PackagedFontsOptions.allow} if a
 * document's families are known in advance.
 *
 * What you trade for that is one reflow. The eager form settles before the first layout, so
 * the document paginates once; this form cannot know the families until the file is parsed,
 * so the document opens on the engine's fixed measurer and re-paginates when the faces
 * arrive. Nothing is fetched from a third party either way — the bytes are the ones inside
 * this package.
 *
 * The families are file-derived, so they are matched case-insensitively against the closed
 * {@link ALL_DEFAULT_FONT_FAMILIES} list and {@link PACKAGED_FAMILY_ALIASES}, and never used
 * to build a path. A name outside both resolves to nothing here; pair with `googleFonts()`
 * to cover more.
 */
export function packagedFonts(options: PackagedFontsOptions = {}): PackagedFontsResolver {
  const allowed = options.allow
    ? new Set(options.allow.map((family) => family.toLowerCase()))
    : null;

  const supportedFamilies = Object.freeze([
    ...ALL_DEFAULT_FONT_FAMILIES.filter((family) => !allowed || allowed.has(family.toLowerCase())),
    ...Object.entries(PACKAGED_FAMILY_ALIASES)
      .filter(
        ([alias, family]) =>
          !allowed || allowed.has(alias.toLowerCase()) || allowed.has(family.toLowerCase())
      )
      .map(([alias]) => alias),
  ]);

  /**
   * The faces a request names under their own family names (`own-name-faces.ts`): a packaged
   * substitute such as Liberation Serif, or a glyph fallback face. A substitute follows
   * `allow` through the family it substitutes for; a fallback face follows `fallbackFaces`.
   */
  async function loadOwnNameFaces(
    request: FontOriginRequest
  ): Promise<Pick<DefaultFontsFragment, 'sources' | 'failures'>> {
    const already = new Set(
      (request.resolvedFaces ?? []).map((face) => faceKey(face.family, face.weight, face.style))
    );
    const eager = options.loading === 'eager' || !request.faces;
    const files = new Map<string, DefaultFontSource['request']>();
    for (const declared of new Set(request.families)) {
      const entry = OWN_NAME_FAMILIES.get(declared.trim().toLowerCase());
      if (!entry) continue;
      if (entry.substituteFor) {
        if (allowed && !allowed.has(entry.substituteFor.toLowerCase())) continue;
      } else if (options.fallbackFaces === false) continue;
      const named = (request.faces ?? []).filter(
        (face) => face.family.trim().toLowerCase() === entry.family.toLowerCase()
      );
      // A fallback face has one file, and the request that names its family needs it.
      const faces = eager || !entry.substituteFor ? entry.faces : ownNameFacesFor(entry, named);
      for (const face of faces) {
        if (already.has(faceKey(entry.family, face.weight, face.style))) continue;
        files.set(face.file, { family: entry.family, weight: face.weight, style: face.style });
      }
    }
    const sources: DefaultFontSource[] = [];
    const failures: DefaultFontLoadFailure[] = [];
    await Promise.all(
      [...files].map(async ([file, face]) => {
        const manifest = manifestByFile.get(file);
        if (!manifest) {
          failures.push({
            family: face.family,
            file,
            diagnostic: 'face missing from packaged manifest',
          });
          return;
        }
        try {
          const bytes = await fetchFontFile(
            { url: assetUrl(file), byteLength: manifest.byteLength, source: 'packaged' },
            options.fetcher ?? fetch,
            request.signal
          );
          sources.push({
            request: face,
            id: sourceIdForFile(file),
            bytes,
            hash: manifest.hash,
            faceIndex: 0,
          });
        } catch (error) {
          if (request.signal?.aborted) throw request.signal.reason ?? error;
          failures.push({
            family: face.family,
            file,
            diagnostic: error instanceof Error ? error.message : String(error),
          });
        }
      })
    );
    return { sources, failures };
  }

  async function resolvePackagedFonts(request: FontOriginRequest): Promise<PackagedFontsFragment> {
    const [word, own] = await Promise.all([
      resolveWordFamilies(request),
      loadOwnNameFaces(request),
    ]);
    if (own.sources.length === 0 && own.failures.length === 0) return word;
    report(own.failures);
    const sources = new Map(
      [...word.sources, ...own.sources].map((source) => [source.id, source] as const)
    );
    return {
      ...word,
      // One order whatever fetch finished first, so the configuration fingerprints stably.
      sources: [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
      failures: [...word.failures, ...own.failures],
    };
  }

  async function resolveWordFamilies(request: FontOriginRequest): Promise<PackagedFontsFragment> {
    // Faces an earlier origin in the composition can already PAINT. Loading them again
    // would spend the bytes on a fragment first-wins composition is bound to drop.
    const already = new Set(
      (request.resolvedFaces ?? []).map((face) => faceKey(face.family, face.weight, face.style))
    );
    // The faces the document uses under one declared name, or every face when the request
    // does not say.
    // `'eager'` loads every face, as if the request named none.
    const neededFaces = facesNeeded(options.loading === 'eager' ? undefined : request.faces);
    /** Faces to load, by Word family. */
    const toLoad = new Map<DefaultFontFamily, Set<(typeof FACES)[number]>>();
    const load = (family: DefaultFontFamily, face: (typeof FACES)[number]): void => {
      const faces = toLoad.get(family) ?? new Set();
      faces.add(face);
      toLoad.set(family, faces);
    };
    /** Families whose text uses a face this resolver serves, for the background load. */
    const used = new Set<DefaultFontFamily>();
    // Substitutions for faces an earlier origin covers under the SUBSTITUTE's own name. The
    // bytes are there, but nothing maps the Word name to them: a caller who registers Carlito
    // by name has not said it stands in for Calibri, and without this record the Word name
    // resolves to nothing at all. No bytes load for these.
    const aliasOnly: DefaultFontSubstitution[] = [];
    const redirect = (
      from: string,
      plan: FamilyPlan,
      face: (typeof FACES)[number],
      to?: string
    ): void => void aliasOnly.push(aliasSubstitution(from, plan, face, to));
    // The default family counts as declared: a document whose runs name no font still
    // renders in one, and leaving it out would load nothing for a file that is entirely
    // default-styled.
    const seen = new Set<string>();
    /** The alias names the document wrote, by the family whose faces serve them. */
    const aliases = new Map<DefaultFontFamily, string[]>();
    for (const declared of [request.defaultFamily, ...request.families]) {
      const fold = declared.toLowerCase();
      if (seen.has(fold)) continue;
      seen.add(fold);
      const aliasOf = aliasesByFoldedName.get(fold);
      if (aliasOf) {
        if (allowed && !allowed.has(fold) && !allowed.has(aliasOf.toLowerCase())) continue;
        const plan = FAMILY_PLANS.get(aliasOf)!;
        // Each face of the alias points where its family's face is painted: at bytes an
        // earlier origin supplies under the family's own name (a host's real Arial), or else
        // at the packaged substitute, which loads unless an earlier origin paints it.
        aliases.set(aliasOf, [...(aliases.get(aliasOf) ?? []), declared]);
        for (const face of neededFaces(declared)) {
          if (already.has(faceKey(declared, face.weight, face.style))) continue;
          used.add(aliasOf);
          // The packaged face first: it is bytes for certain. A painted face under the family's
          // own name can itself be a redirect, such as the Arial bold of an earlier answer.
          const source = planSourceFace(plan, face);
          if (already.has(faceKey(plan.substitute, source.weight, source.style)))
            redirect(declared, plan, face);
          else if (already.has(faceKey(aliasOf, face.weight, face.style)))
            redirect(declared, plan, face, aliasOf);
          else {
            redirect(declared, plan, face);
            load(aliasOf, face);
          }
        }
        continue;
      }
      const family = wordFamiliesByFoldedName.get(fold);
      if (!family) continue;
      if (allowed && !allowed.has(family.toLowerCase())) continue;
      const plan = FAMILY_PLANS.get(family)!;
      for (const face of neededFaces(declared)) {
        // Under the Word name the document wrote, or under the face this would load: an
        // earlier origin may have reported either. Every face ends with bytes, a redirect to
        // bytes, or a load: none is left with neither.
        if (already.has(faceKey(family, face.weight, face.style))) continue;
        used.add(family);
        const source = planSourceFace(plan, face);
        if (already.has(faceKey(plan.substitute, source.weight, source.style)))
          redirect(family, plan, face);
        else load(family, face);
      }
    }
    // Stable order regardless of how the document happened to declare them, so the same
    // file composes to the same configuration on every load.
    const families = ALL_DEFAULT_FONT_FAMILIES.filter((family) => toLoad.has(family));
    const fetcher = options.fetcher ?? fetch;
    const deferred = (): { deferred?: Promise<PackagedFontsFragment> } => {
      const later = otherFacesLater(request, used, toLoad, already, aliases);
      return later ? { deferred: later } : {};
    };
    if (families.length === 0)
      return {
        sources: [],
        substitutions: aliasOnly,
        failures: [],
        families,
        supportedFamilies,
        ...deferred(),
      };

    const fragment = await loadPackagedFaces(
      families.map((family) => ({
        family,
        faces: FACES.filter((face) => toLoad.get(family)!.has(face)),
      })),
      fetcher,
      request.signal
    );
    report(fragment.failures);
    // Core registers private aliases, preserving native glyph fallback and host-page fonts.
    return {
      ...fragment,
      substitutions: [...aliasOnly, ...fragment.substitutions],
      families,
      supportedFamilies,
      ...deferred(),
    };
  }

  function report(failures: readonly DefaultFontLoadFailure[]): void {
    for (const failure of failures) {
      if (options.onFailure) options.onFailure(failure);
      else console.warn(`[fonts] ${failure.family} (${failure.file}): ${failure.diagnostic}`);
    }
  }

  /**
   * The faces of the families in use that no text uses yet and no earlier origin paints,
   * loaded when the browser is idle after the faces in use: they never share its bandwidth.
   */
  function otherFacesLater(
    request: FontOriginRequest,
    used: ReadonlySet<DefaultFontFamily>,
    loading: ReadonlyMap<DefaultFontFamily, ReadonlySet<(typeof FACES)[number]>>,
    already: ReadonlySet<string>,
    aliases: ReadonlyMap<DefaultFontFamily, readonly string[]>
  ): Promise<PackagedFontsFragment> | undefined {
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
    const entries = [...used].flatMap((family) => {
      const faces = uncoveredFaces(family, FAMILY_PLANS.get(family)!, covered).filter(
        (face) => !loading.get(family)?.has(face)
      );
      return faces.length > 0 ? [{ family, faces }] : [];
    });
    if (entries.length === 0) return;
    const later = idle(request.signal).then(async (): Promise<PackagedFontsFragment> => {
      const fragment = await loadPackagedFaces(
        entries,
        options.fetcher ?? fetch,
        request.signal,
        true
      );
      report(fragment.failures);
      // An alias (Helvetica) reaches the new faces of its family too.
      const loaded = new Set(fragment.sources.map((source) => source.id));
      const aliasSubstitutions = entries.flatMap(({ family, faces }) => {
        const plan = FAMILY_PLANS.get(family)!;
        return faces
          .filter((face) =>
            loaded.has(sourceIdForFile(planFaceFile(plan, planSourceFace(plan, face).suffix)))
          )
          .flatMap((face) =>
            (aliases.get(family) ?? []).map((alias) => aliasSubstitution(alias, plan, face))
          );
      });
      return {
        ...fragment,
        substitutions: [...fragment.substitutions, ...aliasSubstitutions],
        families: ALL_DEFAULT_FONT_FAMILIES.filter((family) =>
          entries.some((entry) => entry.family === family)
        ),
        supportedFamilies,
      };
    });
    // Nothing may wait on it: a cancelled or failed background load is not an error.
    later.catch(() => {});
    return later;
  }

  return markResolver(resolvePackagedFonts);
}

export { FONT_ASSET_MANIFEST, type FontAssetManifestEntry } from './manifest.generated.ts';
