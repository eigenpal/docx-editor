// What `settings.xml` says about AUTOMATIC HYPHENATION (ECMA-376 §17.15.1.11–.53).
//
// Four document-level controls, all optional. Absence is the answer, never an error:
//
//   - `w:autoHyphenation` (`ST_OnOff`): hyphenate overflowing words. Default OFF.
//   - `w:hyphenationZone` (`ST_TwipsMeasure`): maximum accepted ragged whitespace. When
//     unused line space exceeds the zone, layout may hyphenate. Default 360 twips (18pt).
//   - `w:doNotHyphenateCaps` (`ST_OnOff`): do not hyphenate a word of all capital letters.
//   - `w:consecutiveHyphenLimit` (`ST_DecimalNumber`): max consecutive hyphenated lines,
//     or unlimited when absent or non-positive.
//
// Hostile authored numbers are dropped or clamped. Nothing from the file is a loop bound.

import {
  isSettingsElement,
  settingsAttributeValue,
  settingsChildNamed,
  settingsOnOff,
} from './settings-onoff.ts';
import { TWIPS_PER_POINT } from '../units.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** Word's default hyphenation zone: 0.25" = 360 twips = 18pt. */
export const DEFAULT_HYPHENATION_ZONE_TWIPS = 360;

/** {@link DEFAULT_HYPHENATION_ZONE_TWIPS} in points. */
export const DEFAULT_HYPHENATION_ZONE_PT = DEFAULT_HYPHENATION_ZONE_TWIPS / TWIPS_PER_POINT;

/**
 * Soft ceiling matching `MAX_TAB_POSITION_TWIPS` (≈ 22"), so a hostile zone cannot
 * shove layout into pathological widths.
 */
export const MAX_HYPHENATION_ZONE_TWIPS = 31_680;

/** Practical cap on consecutive hyphenated lines. Larger authored values clamp here. */
export const MAX_CONSECUTIVE_HYPHEN_LIMIT = 255;

/** Document hyphenation settings after a bounded read of `settings.xml`. */
export interface DocumentHyphenationSettings {
  /** `w:autoHyphenation` — the document asks layout to hyphenate overflowing words. */
  readonly autoHyphenation: boolean;
  /**
   * `w:hyphenationZone` in points — the maximum accepted ragged remainder.
   *
   * Always a finite, clamped value. When the element is absent or invalid, this is
   * {@link DEFAULT_HYPHENATION_ZONE_PT} (18pt), which is also Word's fallback when
   * auto-hyphenation is on. Ordinary wrap hyphenates only when slack exceeds this.
   */
  readonly hyphenationZonePt: number;
  /** `w:doNotHyphenateCaps` — do not hyphenate a word written in all capital letters. */
  readonly doNotHyphenateCaps: boolean;
  /**
   * `w:consecutiveHyphenLimit`, or `null` when omitted, non-positive, or unreadable.
   *
   * `null` means unlimited. Positive values are clamped to
   * {@link MAX_CONSECUTIVE_HYPHEN_LIMIT}.
   */
  readonly consecutiveHyphenLimit: number | null;
}

/** Frozen defaults: hyphenation off, Word's 18pt zone, caps allowed, no consecutive cap. */
export const DEFAULT_HYPHENATION_SETTINGS: DocumentHyphenationSettings = Object.freeze({
  autoHyphenation: false,
  hyphenationZonePt: DEFAULT_HYPHENATION_ZONE_PT,
  doNotHyphenateCaps: false,
  consecutiveHyphenLimit: null,
});

function integerTwips(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  // Up to 9 digits so oversized values reach the clamp; longer strings are garbage.
  if (!/^-?\d{1,9}$/.test(raw)) return null;
  return Number(raw);
}

function clampZoneTwips(twips: number): number | null {
  if (!Number.isFinite(twips) || twips < 0) return null;
  return twips > MAX_HYPHENATION_ZONE_TWIPS ? MAX_HYPHENATION_ZONE_TWIPS : twips;
}

function hyphenationZonePt(root: OoxmlElement): number {
  const element = settingsChildNamed(root, 'hyphenationZone');
  if (!element) return DEFAULT_HYPHENATION_ZONE_PT;
  const clamped = clampZoneTwips(integerTwips(settingsAttributeValue(element, 'val')) ?? NaN);
  if (clamped === null) return DEFAULT_HYPHENATION_ZONE_PT;
  return clamped / TWIPS_PER_POINT;
}

function consecutiveHyphenLimit(root: OoxmlElement): number | null {
  const element = settingsChildNamed(root, 'consecutiveHyphenLimit');
  if (!element) return null;
  const raw = settingsAttributeValue(element, 'val');
  if (raw === undefined || !/^-?\d{1,9}$/.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value > MAX_CONSECUTIVE_HYPHEN_LIMIT ? MAX_CONSECUTIVE_HYPHEN_LIMIT : value;
}

/** Read hyphenation settings from a `settings.xml` root, or the defaults when it has none. */
export function readHyphenationSettings(
  settingsRoot: OoxmlNode | null | undefined
): DocumentHyphenationSettings {
  if (!isSettingsElement(settingsRoot)) return DEFAULT_HYPHENATION_SETTINGS;
  return {
    autoHyphenation: settingsOnOff(settingsRoot, 'autoHyphenation'),
    hyphenationZonePt: hyphenationZonePt(settingsRoot),
    doNotHyphenateCaps: settingsOnOff(settingsRoot, 'doNotHyphenateCaps'),
    consecutiveHyphenLimit: consecutiveHyphenLimit(settingsRoot),
  };
}

/**
 * Compact fingerprint for layout cache keys.
 *
 * Hosts that later consult these settings must name them in the break key, or a
 * settings-only change would reuse unhyphenated lines.
 */
export function hyphenationSettingsFingerprint(settings: DocumentHyphenationSettings): string {
  if (!settings.autoHyphenation) return 'hyph:off';
  const limit =
    settings.consecutiveHyphenLimit === null ? 'u' : String(settings.consecutiveHyphenLimit);
  const caps = settings.doNotHyphenateCaps ? '1' : '0';
  return `hyph:on:${Math.round(settings.hyphenationZonePt * 1000)}:${caps}:${limit}`;
}

/** Producer-key suffix. Empty when the host did not supply settings. */
export function hyphenationProducerSuffix(
  settings: DocumentHyphenationSettings | undefined
): string {
  return settings === undefined ? '' : `|${hyphenationSettingsFingerprint(settings)}`;
}
