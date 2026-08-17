// HYPERLINK field instruction parsing (§17.16.5.25).
//
// The instruction is attacker-controlled. The parser recognizes the grammar and hands the raw
// pieces over VERBATIM — case and percent-encoding preserved, smuggled control characters
// intact — because sanitization belongs to the surface's one href trust boundary, not here.
// Every hostile shape resolves to null or a capped value, never a hang or a throw.

import { describe, expect, test } from 'bun:test';
import { MAX_HYPERLINK_INSTRUCTION_CHARS, parseHyperlinkInstruction } from '../field-link.ts';

describe('grammar', () => {
  test('a quoted target parses verbatim, case and percent-encoding preserved', () => {
    expect(parseHyperlinkInstruction(' HYPERLINK "https://Example.com/Path%20A?q=B%2Fc" ')).toEqual(
      {
        target: 'https://Example.com/Path%20A?q=B%2Fc',
        anchor: null,
        tooltip: null,
      }
    );
  });

  test('a bare target parses too', () => {
    expect(parseHyperlinkInstruction(' HYPERLINK https://example.com ')).toEqual({
      target: 'https://example.com',
      anchor: null,
      tooltip: null,
    });
  });

  test('the keyword is case-insensitive; the values are not', () => {
    expect(parseHyperlinkInstruction(' hyperlink "https://EXAMPLE.com" ')).toEqual({
      target: 'https://EXAMPLE.com',
      anchor: null,
      tooltip: null,
    });
  });

  test('\\l alone is an anchor-only link', () => {
    expect(parseHyperlinkInstruction(' HYPERLINK \\l "section3" ')).toEqual({
      target: null,
      anchor: 'section3',
      tooltip: null,
    });
  });

  test('target, \\l and \\o combine in any order', () => {
    expect(
      parseHyperlinkInstruction(' HYPERLINK \\o "Open the site" "https://example.com" \\l top ')
    ).toEqual({
      target: 'https://example.com',
      anchor: 'top',
      tooltip: 'Open the site',
    });
  });

  test('duplicate targets and switches: first wins', () => {
    expect(
      parseHyperlinkInstruction(
        ' HYPERLINK "https://first.example" "https://second.example" \\l one \\l two \\o "a" \\o "b" '
      )
    ).toEqual({ target: 'https://first.example', anchor: 'one', tooltip: 'a' });
  });

  test('\\t, \\m and \\n consume their argument without it becoming the target', () => {
    expect(
      parseHyperlinkInstruction(' HYPERLINK \\t "_blank" \\n x "https://example.com" ')
    ).toEqual({
      target: 'https://example.com',
      anchor: null,
      tooltip: null,
    });
  });

  test('\\* MERGEFORMAT never becomes the target', () => {
    expect(parseHyperlinkInstruction(' HYPERLINK \\l "x" \\* MERGEFORMAT ')).toEqual({
      target: null,
      anchor: 'x',
      tooltip: null,
    });
  });

  test('an unknown switch is inert and consumes nothing', () => {
    expect(parseHyperlinkInstruction(' HYPERLINK \\z "https://example.com" ')).toEqual({
      target: 'https://example.com',
      anchor: null,
      tooltip: null,
    });
  });

  test('no target and no anchor is not a link', () => {
    expect(parseHyperlinkInstruction(' HYPERLINK ')).toBeNull();
    expect(parseHyperlinkInstruction(' HYPERLINK \\o "tip only" ')).toBeNull();
    expect(parseHyperlinkInstruction(' HYPERLINK "" ')).toBeNull();
  });

  test('another instruction is not a HYPERLINK', () => {
    expect(parseHyperlinkInstruction(' PAGE ')).toBeNull();
    expect(parseHyperlinkInstruction(' SYMBOL 65 ')).toBeNull();
    // A QUOTED first token is data, not a keyword.
    expect(parseHyperlinkInstruction(' "HYPERLINK" "https://example.com" ')).toBeNull();
  });
});

describe('hostile input', () => {
  test('an unclosed quote runs to the end without hanging', () => {
    expect(parseHyperlinkInstruction(' HYPERLINK "https://example.com/unterminated ')).toEqual({
      target: 'https://example.com/unterminated ',
      anchor: null,
      tooltip: null,
    });
  });

  test('a 100KB instruction is refused outright', () => {
    const raw = ` HYPERLINK "https://example.com/${'a'.repeat(100_000)}" `;
    expect(raw.length).toBeGreaterThan(MAX_HYPERLINK_INSTRUCTION_CHARS);
    expect(parseHyperlinkInstruction(raw)).toBeNull();
  });

  test('embedded tab and newline in a quoted target pass through for the sanitizer', () => {
    // Stripping `java\nscript:` smuggles is `sanitizeHref`'s job at the surface; the parser
    // must hand the raw string over or the boundary would be checking a different value.
    expect(parseHyperlinkInstruction(' HYPERLINK "java\nscri\tpt:alert(1)" ')).toEqual({
      target: 'java\nscri\tpt:alert(1)',
      anchor: null,
      tooltip: null,
    });
  });

  test('backslash-heavy garbage yields no link and no hang', () => {
    expect(parseHyperlinkInstruction(` HYPERLINK ${'\\'.repeat(512)} `)).toBeNull();
    expect(parseHyperlinkInstruction(' HYPERLINK \\l \\o \\t ')).toBeNull();
  });

  test('an over-cap anchor is ignored rather than truncated', () => {
    expect(parseHyperlinkInstruction(` HYPERLINK \\l "${'a'.repeat(300)}" `)).toBeNull();
    expect(
      parseHyperlinkInstruction(` HYPERLINK "https://example.com" \\o "${'t'.repeat(300)}" `)
    ).toEqual({ target: 'https://example.com', anchor: null, tooltip: null });
  });
});
