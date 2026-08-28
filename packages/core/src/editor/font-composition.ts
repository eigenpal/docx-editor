// Font configuration composition — the ONE documented way the three font origins
// (explicit app bytes, embedded document faces, substitute packages) become a single
// immutable `FontConfiguration`.
//
// Precedence is positional and first-wins: the base's sources beat every fragment's, and
// an earlier fragment beats a later one, keyed by (family, weight, style) — the same key
// `createFontResourceSnapshot` uses, which THROWS on duplicates. Composition is therefore
// also the dedup point: without it, handing an explicit Calibri and an embedded Calibri
// to the snapshot is a construction error rather than a precedence decision.
//
// Substitutions concatenate first-wins by their `from` face — and any substitution whose
// `from` is covered by a direct source is DROPPED here. The resource snapshot consults
// substitutions BEFORE sources, so an unfiltered Calibri→Carlito entry would beat real
// Calibri bytes; the contract says a direct source always wins, and this filter is where
// that promise is kept.

import type {
  FontConfiguration,
  FontSource,
  FontSourceSubstitution,
} from '@docx-editor.dev/core/contracts/editor';
import { HARD_MAX_FONT_BYTES, fontRequestKey } from '@docx-editor.dev/core/layout';

/**
 * A partial font configuration one origin contributes: sources, substitutions, or both.
 * `loadDefaultFonts()` (the substitute package) and `loadFonts()` (the fetch helper) both
 * return this shape, so every origin composes through `composeFontConfiguration` the
 * same way.
 */
export interface FontConfigurationFragment {
  readonly sources?: readonly FontSource[];
  readonly substitutions?: readonly FontSourceSubstitution[];
}

/**
 * The base of a composition: everything a `FontConfiguration` carries, all optional.
 * Omitted fields take the documented defaults (`epoch` 0, `maxFontBytes` at the engine
 * hard maximum, `defaultFont` Calibri at 11pt — Word's own default face and size).
 */
export interface FontConfigurationBase extends FontConfigurationFragment {
  /**
   * Identity of this configuration's byte set. The engine uses it to tell one resolved
   * font set from another; leave it unset and the editor supplies the load sequence.
   */
  readonly epoch?: number;
  /** Per-face byte ceiling. Defaults to the engine hard maximum; lower it to tighten intake. */
  readonly maxFontBytes?: number;
  /** The face used when a run names no font. Defaults to Word's own: Calibri at 11pt. */
  readonly defaultFont?: FontConfiguration['defaultFont'];
  /** BCP-47 tag passed to the shaper for language-sensitive shaping. */
  readonly language?: string;
}

/** Validated metadata from one `word/fontTable.xml` family declaration. */
export interface FontFamilyMetadata {
  readonly family: string;
  /** Ten-byte PANOSE classification as 20 lowercase hexadecimal characters. */
  readonly panose?: string;
}

/**
 * What the document turned out to need, handed to an on-demand resolver.
 *
 * The families are the ones the file actually names — already name-validated and capped,
 * so a resolver may treat them as a list to look up, never as URLs or paths to build.
 */
export interface FontResolutionRequest {
  /**
   * Families declared anywhere in the document (body, headers/footers, styles), deduped,
   * sorted, and capped at {@link MAX_RESOLVER_FAMILIES}.
   */
  readonly families: readonly string[];
  /** The face a run naming no font resolves to, so a resolver can cover it too. */
  readonly defaultFamily: string;
  /** Bounded font-table metadata that a resolver may use to rank closed substitutes. */
  readonly metadata?: readonly FontFamilyMetadata[];
}

/**
 * Resolve fonts once the document's needs are known, instead of ahead of them.
 *
 * Called once per load, AFTER the file is parsed and mounted, with the families it
 * declares; whatever it returns composes exactly like a statically supplied fragment.
 * Returning nothing is a valid answer — it means "I cover none of this", and the
 * document stays on the fixed measurer.
 *
 * A resolver that fetches makes opening a document perform network requests. That is a
 * real change in posture and it must stay the APP's decision: the engine never supplies
 * one, and the families here are file-derived, so a resolver must look them up in a set
 * it shipped rather than interpolate them into a URL.
 */
export type FontResolver = (
  request: FontResolutionRequest
) =>
  | FontConfiguration
  | FontConfigurationFragment
  | undefined
  | Promise<FontConfiguration | FontConfigurationFragment | undefined>;

/**
 * Ceiling on the families one document can put in front of a resolver.
 *
 * A resolver typically turns each family into up to four faces, and the resource snapshot
 * refuses more than `HARD_MAX_FONT_SOURCES` (256) sources — so 64 families is the point
 * past which a document could no longer be served anyway. Capping here means a file
 * declaring thousands of distinct `w:rFonts` cannot fan a resolver out across thousands
 * of lookups (or fetches) before that limit is ever reached.
 */
export const MAX_RESOLVER_FAMILIES = 64;

/** Word's document default when nothing else says otherwise: Calibri at 11pt. */
export const WORD_DEFAULT_FONT: FontConfiguration['defaultFont'] = Object.freeze({
  family: 'Calibri',
  sizeHalfPoints: 22,
});

/**
 * Merge a base and any number of fragments into one frozen `FontConfiguration`.
 *
 * A bare fragment IS a valid base, so the single-origin case is one argument:
 * `composeFontConfiguration(await loadDefaultFonts())`. Pass extra fragments to layer
 * origins, and set `epoch`/`maxFontBytes`/`defaultFont` on the base only when you need
 * something other than the documented defaults.
 *
 * - Sources dedupe first-wins by (family, weight, style), in argument order — base
 *   before fragments, earlier fragments before later ones.
 * - Substitutions dedupe first-wins by their `from` face, in the same order, and every
 *   substitution whose `from` face has a direct source anywhere in the composition is
 *   dropped: a real face always beats a stand-in.
 * - The result is frozen (arrays included); the byte arrays themselves are the callers'
 *   and are not copied here — the resource snapshot takes its own defensive copy.
 */
export function composeFontConfiguration(
  base: FontConfigurationBase,
  ...fragments: readonly FontConfigurationFragment[]
): FontConfiguration {
  const origins: readonly FontConfigurationFragment[] = [base, ...fragments];

  const sources: FontSource[] = [];
  const sourceKeys = new Set<string>();
  for (const origin of origins) {
    for (const source of origin.sources ?? []) {
      const key = fontRequestKey(source.request);
      if (sourceKeys.has(key)) continue;
      sourceKeys.add(key);
      sources.push(source);
    }
  }

  const substitutions: FontSourceSubstitution[] = [];
  const substitutionKeys = new Set<string>();
  for (const origin of origins) {
    for (const substitution of origin.substitutions ?? []) {
      const key = fontRequestKey(substitution.from);
      if (sourceKeys.has(key) || substitutionKeys.has(key)) continue;
      substitutionKeys.add(key);
      substitutions.push(substitution);
    }
  }

  return Object.freeze({
    epoch: base.epoch ?? 0,
    maxFontBytes: base.maxFontBytes ?? HARD_MAX_FONT_BYTES,
    sources: Object.freeze(sources),
    ...(substitutions.length > 0 ? { substitutions: Object.freeze(substitutions) } : {}),
    defaultFont: base.defaultFont ?? WORD_DEFAULT_FONT,
    ...(base.language !== undefined ? { language: base.language } : {}),
  });
}
