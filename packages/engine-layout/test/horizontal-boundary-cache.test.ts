// Cache-correctness guards for the cumulative geometry-trust watermark.
//
// The watermark exists so a per-character caret-edge probe does not re-walk the
// whole line prefix on every call. Independent review showed the first version was
// keyed on `(fullText, lineStart)` only, while the answer it caches depends on the
// metrics port's `provesCharacterAdvance`. Because the cache is module-global, a
// permissive port could warm it and a stricter port then read the permissive
// answer — publishing a caret edge as navigable / `per-grapheme-advance` whose
// advance is not provable, which is precisely what this probe exists to refuse.

import { describe, expect, test } from 'bun:test';
import { isCumulativeGeometryTrustedFromLineOrigin } from '../src/horizontal-boundary.ts';
import { resetGraphemeBoundary, setGraphemeBoundary } from '../src/grapheme.ts';
import { PER_GRAPHEME_SHAPING } from '../src/shaping.ts';
import type { MetricsPort } from '../src/metrics.ts';

/** A port that proves an advance only for characters in `provable`. */
function portProving(provable: string): MetricsPort {
  return {
    shaping: PER_GRAPHEME_SHAPING,
    lineHeight: 16,
    advance: () => 8,
    provesCharacterAdvance: (char: string) => provable.includes(char),
  } as unknown as MetricsPort;
}

const TEXT = 'abcdefghij';

describe('cumulative geometry trust cache', () => {
  test('a permissive port cannot warm the answer for a stricter port', () => {
    const permissive = portProving(TEXT);
    const strict = portProving('fghij'); // a..e unprovable

    // Warm the watermark past the strict port's first unprovable offset.
    expect(isCumulativeGeometryTrustedFromLineOrigin(permissive, TEXT, 0, 6)).toBe(true);

    // The strict port must get its own answer, not the warm one.
    const warm = isCumulativeGeometryTrustedFromLineOrigin(strict, TEXT, 0, 8);
    expect(warm).toBe(false);
  });

  test('the same query from a cold cache agrees with the warm result', () => {
    const strict = portProving('fghij');
    const cold = isCumulativeGeometryTrustedFromLineOrigin(strict, TEXT, 0, 8);
    // Establish the reference value independently of any warming order.
    expect(cold).toBe(false);

    const permissive = portProving(TEXT);
    expect(isCumulativeGeometryTrustedFromLineOrigin(permissive, TEXT, 0, 8)).toBe(true);
    // And back again — switching ports must not carry an answer across.
    expect(isCumulativeGeometryTrustedFromLineOrigin(strict, TEXT, 0, 8)).toBe(false);
  });

  test('a line origin is trusted regardless of port strictness', () => {
    const strict = portProving('');
    expect(isCumulativeGeometryTrustedFromLineOrigin(strict, TEXT, 3, 3)).toBe(true);
  });

  test('changing the grapheme boundary invalidates the watermark', () => {
    // Keying on the metrics port closed only half of this. `graphemeAtIndex` goes
    // through `segmentGraphemes`, so the answer also depends on WHICH boundary is
    // installed. Round-4 review proved both directions: warmed under a per-code-unit
    // boundary, a stale `true` survived a switch to a grouping boundary — publishing
    // `navigable: true` for an edge whose advance is unprovable, exactly what this
    // probe exists to refuse.
    const text = 'ab中'; // CJK third character
    const port = portProving('ab'); // proves ASCII only, not the CJK unit

    // Per-code-unit boundary: each character is its own grapheme.
    setGraphemeBoundary({
      segment: (t: string) => [...t].map((ch, i) => ({ index: i, text: ch, utf16From: i, utf16To: i + 1 })),
    });
    const perUnit = isCumulativeGeometryTrustedFromLineOrigin(port, text, 0, 2);

    // Grouping boundary: the whole string is one grapheme, so offset 2 sits inside
    // a cluster containing the unprovable CJK unit.
    setGraphemeBoundary({
      segment: (t: string) => [{ index: 0, text: t, utf16From: 0, utf16To: t.length }],
    });
    const grouped = isCumulativeGeometryTrustedFromLineOrigin(port, text, 0, 2);

    // Establish the grouped answer from cold, so the comparison is against truth
    // rather than against whatever happened to be cached.
    resetGraphemeBoundary();
    setGraphemeBoundary({
      segment: (t: string) => [{ index: 0, text: t, utf16From: 0, utf16To: t.length }],
    });
    const groupedCold = isCumulativeGeometryTrustedFromLineOrigin(port, text, 0, 2);

    expect(grouped).toBe(groupedCold);
    expect(perUnit).not.toBe(groupedCold);
    resetGraphemeBoundary();
  });
});
