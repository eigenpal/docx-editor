// `settings.xml` automatic-hyphenation controls (ECMA-376 §17.15.1.11–.53).

import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HYPHENATION_SETTINGS,
  DEFAULT_HYPHENATION_ZONE_PT,
  DEFAULT_HYPHENATION_ZONE_TWIPS,
  MAX_CONSECUTIVE_HYPHEN_LIMIT,
  MAX_HYPHENATION_ZONE_TWIPS,
  hyphenationProducerSuffix,
  hyphenationSettingsFingerprint,
  readHyphenationSettings,
  readOoxmlPart,
} from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function settingsRoot(inner: string) {
  const result = readOoxmlPart(`<w:settings xmlns:w="${W}">${inner}</w:settings>`, {
    name: '/word/settings.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

describe('w:autoHyphenation', () => {
  test('absent means hyphenation is off', () => {
    expect(readHyphenationSettings(settingsRoot('')).autoHyphenation).toBe(false);
  });

  test('present turns hyphenation on', () => {
    expect(readHyphenationSettings(settingsRoot('<w:autoHyphenation/>')).autoHyphenation).toBe(
      true
    );
  });

  test('an explicit false stays off', () => {
    for (const value of ['0', 'false', 'off']) {
      const root = settingsRoot(`<w:autoHyphenation w:val="${value}"/>`);
      expect(readHyphenationSettings(root).autoHyphenation).toBe(false);
    }
  });

  test('an explicit true is still true', () => {
    for (const value of ['1', 'true', 'on']) {
      const root = settingsRoot(`<w:autoHyphenation w:val="${value}"/>`);
      expect(readHyphenationSettings(root).autoHyphenation).toBe(true);
    }
  });
});

describe('w:hyphenationZone', () => {
  test('absent falls back to Word’s 18pt default', () => {
    expect(DEFAULT_HYPHENATION_ZONE_PT).toBe(18);
    expect(DEFAULT_HYPHENATION_ZONE_TWIPS).toBe(360);
    expect(readHyphenationSettings(settingsRoot('<w:autoHyphenation/>')).hyphenationZonePt).toBe(
      18
    );
    expect(readHyphenationSettings(settingsRoot('')).hyphenationZonePt).toBe(18);
  });

  test('a twips value converts to points', () => {
    const root = settingsRoot('<w:autoHyphenation/><w:hyphenationZone w:val="720"/>');
    expect(readHyphenationSettings(root).hyphenationZonePt).toBe(36);
  });

  test('zero is kept', () => {
    const root = settingsRoot('<w:hyphenationZone w:val="0"/>');
    expect(readHyphenationSettings(root).hyphenationZonePt).toBe(0);
  });

  test('a hostile oversized value clamps', () => {
    const root = settingsRoot(`<w:hyphenationZone w:val="${MAX_HYPHENATION_ZONE_TWIPS + 1}"/>`);
    expect(readHyphenationSettings(root).hyphenationZonePt).toBe(MAX_HYPHENATION_ZONE_TWIPS / 20);
  });

  test('garbage, negatives, and over-long strings fall back to 18pt', () => {
    for (const value of ['not-a-number', '-100', '2cm', '1'.repeat(12)]) {
      const root = settingsRoot(`<w:autoHyphenation/><w:hyphenationZone w:val="${value}"/>`);
      expect(readHyphenationSettings(root).hyphenationZonePt).toBe(18);
    }
  });
});

describe('w:doNotHyphenateCaps', () => {
  test('absent means caps may hyphenate', () => {
    expect(readHyphenationSettings(settingsRoot('')).doNotHyphenateCaps).toBe(false);
  });

  test('present suppresses all-caps hyphenation', () => {
    expect(
      readHyphenationSettings(settingsRoot('<w:doNotHyphenateCaps/>')).doNotHyphenateCaps
    ).toBe(true);
  });

  test('an explicit false restores caps hyphenation', () => {
    const root = settingsRoot('<w:doNotHyphenateCaps w:val="0"/>');
    expect(readHyphenationSettings(root).doNotHyphenateCaps).toBe(false);
  });
});

describe('w:consecutiveHyphenLimit', () => {
  test('absent means unlimited', () => {
    expect(readHyphenationSettings(settingsRoot('')).consecutiveHyphenLimit).toBeNull();
  });

  test('a positive limit is kept', () => {
    const root = settingsRoot('<w:consecutiveHyphenLimit w:val="3"/>');
    expect(readHyphenationSettings(root).consecutiveHyphenLimit).toBe(3);
  });

  test('zero and negatives are unlimited', () => {
    expect(
      readHyphenationSettings(settingsRoot('<w:consecutiveHyphenLimit w:val="0"/>'))
        .consecutiveHyphenLimit
    ).toBeNull();
    expect(
      readHyphenationSettings(settingsRoot('<w:consecutiveHyphenLimit w:val="-2"/>'))
        .consecutiveHyphenLimit
    ).toBeNull();
  });

  test('a hostile oversized value clamps', () => {
    const root = settingsRoot('<w:consecutiveHyphenLimit w:val="999999"/>');
    expect(readHyphenationSettings(root).consecutiveHyphenLimit).toBe(MAX_CONSECUTIVE_HYPHEN_LIMIT);
  });

  test('garbage and over-long strings are unlimited', () => {
    for (const value of ['nope', '1'.repeat(12)]) {
      const root = settingsRoot(`<w:consecutiveHyphenLimit w:val="${value}"/>`);
      expect(readHyphenationSettings(root).consecutiveHyphenLimit).toBeNull();
    }
  });
});

describe('defaults and fingerprints', () => {
  test('a document with no settings part gets the defaults', () => {
    expect(readHyphenationSettings(null)).toEqual(DEFAULT_HYPHENATION_SETTINGS);
    expect(readHyphenationSettings(undefined).autoHyphenation).toBe(false);
  });

  test('the off fingerprint is stable, and enabled settings enter the key', () => {
    expect(hyphenationSettingsFingerprint(DEFAULT_HYPHENATION_SETTINGS)).toBe('hyph:off');
    const enabled = readHyphenationSettings(
      settingsRoot(
        '<w:autoHyphenation/><w:hyphenationZone w:val="360"/><w:doNotHyphenateCaps/><w:consecutiveHyphenLimit w:val="2"/>'
      )
    );
    expect(hyphenationSettingsFingerprint(enabled)).toBe('hyph:on:18000:1:2');
    expect(hyphenationProducerSuffix(undefined)).toBe('');
    expect(hyphenationProducerSuffix(DEFAULT_HYPHENATION_SETTINGS)).toBe('|hyph:off');
    expect(hyphenationProducerSuffix(enabled)).toBe('|hyph:on:18000:1:2');
  });
});
