import { describe, expect, test } from 'bun:test';
import { GLYPH_FALLBACK_FAMILIES, glyphFallbackFamiliesFor } from '../font-fallback-rules.ts';
import { glyphFallbackStackOf, withGlyphFallbackAliases } from '../glyph-fallback-aliases.ts';

const none = (): boolean => false;
const asked =
  (families: readonly string[]) =>
  (family: string): boolean =>
    families.includes(family);

describe('the glyph fallback faces that a host loads on demand', () => {
  test('a symbol asks for the symbol faces alone', () => {
    expect(glyphFallbackFamiliesFor('☐', none)).toEqual(['Segoe UI Symbol', 'Noto Sans Symbols 2']);
  });

  test('letters and mathematics ask for the text faces too', () => {
    const text = [
      'Segoe UI Symbol',
      'Noto Sans Symbols 2',
      'Noto Sans Math',
      'Noto Sans Arabic',
      'Times New Roman',
    ];
    expect(glyphFallbackFamiliesFor('م', none)).toEqual(text);
    expect(glyphFallbackFamiliesFor('∑', none)).toEqual(text);
    expect(glyphFallbackFamiliesFor('𝑥', none)).toEqual(text);
  });

  test('emoji presentation asks for the color faces, not the East Asian faces', () => {
    const families = glyphFallbackFamiliesFor('😀', none);
    expect(families).toContain('Twemoji Mozilla');
    expect(families).toContain('Noto Emoji');
    expect(families).not.toContain('Noto Sans CJK JP');
    expect(families).not.toContain('SimSun');
  });

  test('East Asian text asks for the East Asian faces, not the emoji faces', () => {
    const families = glyphFallbackFamiliesFor('中', none);
    expect(families).toContain('Noto Sans CJK JP');
    expect(families).not.toContain('Twemoji Mozilla');
  });

  test('every answer keeps the order of the fallback list', () => {
    for (const characters of ['☐', 'م', '😀', '中', '☐م😀中']) {
      const families = glyphFallbackFamiliesFor(characters, none);
      expect(families).toEqual(GLYPH_FALLBACK_FAMILIES.filter((one) => families.includes(one)));
    }
  });

  test('a character still uncovered after a step asks for the next step', () => {
    const first = glyphFallbackFamiliesFor('☐', none);
    const second = glyphFallbackFamiliesFor('☐', asked(first));
    expect(second.length).toBeGreaterThan(first.length);
    expect(second.slice(0, first.length)).toEqual(first);
    // The East Asian faces come last, when nothing else covers the character.
    expect(second).not.toContain('Noto Sans CJK JP');
    let held = second;
    for (let turn = 0; turn < 4; turn += 1) {
      const next = glyphFallbackFamiliesFor('☐', asked(held));
      if (next.length === 0) break;
      held = next;
    }
    expect(held).toEqual(GLYPH_FALLBACK_FAMILIES);
    expect(glyphFallbackFamiliesFor('☐', asked(held))).toEqual([]);
  });
});

describe('the paint aliases of the glyph fallback faces', () => {
  test('a lookup with no aliases adds nothing to a font stack', () => {
    expect(glyphFallbackStackOf(undefined)).toBe('');
    expect(glyphFallbackStackOf(() => undefined)).toBe('');
  });

  test('the aliases follow in order, once each, without the run alias', () => {
    const lookup = withGlyphFallbackAliases(
      () => undefined,
      ['docx-a', undefined, 'docx-b', 'docx-a', 'docx-c']
    );
    expect(glyphFallbackStackOf(lookup)).toBe('"docx-a", "docx-b", "docx-c", ');
    expect(glyphFallbackStackOf(lookup, 'docx-b')).toBe('"docx-a", "docx-c", ');
  });

  test('an alias that could close a CSS string is dropped', () => {
    const lookup = withGlyphFallbackAliases(() => undefined, ['docx-a', 'x"; color: red']);
    expect(glyphFallbackStackOf(lookup)).toBe('"docx-a", ');
  });
});
