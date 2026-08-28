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
 * @example Load the packaged substitutes and hand them to the editor
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
// name it, so its four ~175 KB assets are opt-in: pass `families` to include it, or use
// `googleFonts()`, which loads the same packaged bytes only when a document asks for it.
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
import { FONT_ASSET_MANIFEST } from './manifest.generated.ts';

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
const assetUrl = (file: string): URL => new URL(`../assets/${file}`, import.meta.url);

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
 * `googleFonts()` covers the extra families on demand instead, so a document that never
 * names Century Gothic never pays for its assets.
 */
export const ALL_WORD_DEFAULT_FAMILIES: readonly WordDefaultFamily[] = Object.freeze([
  ...WORD_DOCUMENT_DEFAULT_FAMILIES,
  'Century Gothic',
]);

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
              id: `default-fonts:${file}`,
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
  options: LoadDefaultFontsOptions & { readonly document?: Document } = {}
): Promise<number> {
  const doc = options.document ?? (typeof document !== 'undefined' ? document : undefined);
  const fontSet = (doc as { fonts?: FontFaceSet } | undefined)?.fonts;
  if (!doc || !fontSet || typeof FontFace === 'undefined') return 0;
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
            const fontFace = new FontFace(family, `url(${assetUrl(file).href})`, {
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
  void installDefaultFontFaces(loadOptions);
  return fragment;
}

export { FONT_ASSET_MANIFEST, type FontAssetManifestEntry } from './manifest.generated.ts';
