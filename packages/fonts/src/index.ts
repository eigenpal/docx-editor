// @docx-editor.dev/fonts — metric-compatible substitutes for Word's default faces.
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
//
// `loadDefaultFonts()` fetches the packaged TTFs (lazily, only the families asked for)
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

import { FONT_ASSET_MANIFEST } from './manifest.generated.ts';

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

export interface DefaultFontSubstitution {
  readonly from: DefaultFontFaceRequest;
  readonly to: DefaultFontFaceRequest;
}

/** The Word default families this package can stand in for. */
export type WordDefaultFamily = 'Calibri' | 'Cambria' | 'Times New Roman' | 'Arial' | 'Courier New';

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

export interface LoadDefaultFontsOptions {
  /** Narrow to specific Word families; default is all five. */
  readonly families?: readonly WordDefaultFamily[];
  /** Injectable for tests; defaults to global `fetch`. */
  readonly fetcher?: typeof fetch;
}

interface FamilyPlan {
  readonly substitute: string;
  readonly filePrefix: string;
}

const FAMILY_PLANS: ReadonlyMap<WordDefaultFamily, FamilyPlan> = new Map([
  ['Calibri', { substitute: 'Carlito', filePrefix: 'Carlito' }],
  ['Cambria', { substitute: 'Caladea', filePrefix: 'Caladea' }],
  ['Times New Roman', { substitute: 'Liberation Serif', filePrefix: 'LiberationSerif' }],
  ['Arial', { substitute: 'Liberation Sans', filePrefix: 'LiberationSans' }],
  ['Courier New', { substitute: 'Liberation Mono', filePrefix: 'LiberationMono' }],
]);

const FACES: readonly {
  readonly suffix: string;
  readonly weight: number;
  readonly style: 'normal' | 'italic';
}[] = [
  { suffix: 'Regular', weight: 400, style: 'normal' },
  { suffix: 'Bold', weight: 700, style: 'normal' },
  { suffix: 'Italic', weight: 400, style: 'italic' },
  { suffix: 'BoldItalic', weight: 700, style: 'italic' },
];

const manifestByFile = new Map(FONT_ASSET_MANIFEST.map((entry) => [entry.file, entry]));

/** Bundler-visible asset URL for one packaged face. */
const assetUrl = (file: string): URL => new URL(`../assets/${file}`, import.meta.url);

export const ALL_WORD_DEFAULT_FAMILIES: readonly WordDefaultFamily[] = Object.freeze([
  'Calibri',
  'Cambria',
  'Times New Roman',
  'Arial',
  'Courier New',
]);

/**
 * Load the packaged substitute faces for the given Word families (all five by default)
 * and return a configuration fragment: byte-backed sources for the SUBSTITUTE families
 * plus the Word-name → substitute substitution map, so a document naming "Calibri"
 * resolves without the host mapping anything.
 *
 * Only the requested families' assets are fetched, in parallel. A face that fails to
 * load appears in `failures` and the rest of the fragment stays usable — compose it
 * anyway and the missing face measures via the engine's fixed fallback.
 */
export async function loadDefaultFonts(
  options: LoadDefaultFontsOptions = {}
): Promise<DefaultFontsFragment> {
  const families = options.families ?? ALL_WORD_DEFAULT_FAMILIES;
  const fetcher = options.fetcher ?? fetch;

  const sources: DefaultFontSource[] = [];
  const substitutions: DefaultFontSubstitution[] = [];
  const failures: DefaultFontLoadFailure[] = [];

  const jobs: Promise<void>[] = [];
  for (const family of families) {
    const plan = FAMILY_PLANS.get(family);
    if (!plan) continue; // Unknown name: nothing to stand in for.
    for (const face of FACES) {
      const file = `${plan.filePrefix}-${face.suffix}.ttf`;
      const manifest = manifestByFile.get(file);
      if (!manifest) {
        failures.push({ family, file, diagnostic: 'face missing from packaged manifest' });
        continue;
      }
      substitutions.push({
        from: { family, weight: face.weight, style: face.style },
        to: { family: plan.substitute, weight: face.weight, style: face.style },
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
  const families = options.families ?? ALL_WORD_DEFAULT_FAMILIES;
  let installed = 0;
  const jobs: Promise<void>[] = [];
  for (const family of families) {
    const plan = FAMILY_PLANS.get(family);
    if (!plan) continue;
    for (const face of FACES) {
      const file = `${plan.filePrefix}-${face.suffix}.ttf`;
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

export { FONT_ASSET_MANIFEST, type FontAssetManifestEntry } from './manifest.generated.ts';
