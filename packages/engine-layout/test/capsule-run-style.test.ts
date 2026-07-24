// Rendering formatting carried in a preservation capsule (M4.0 follow-up).

import { describe, expect, test } from 'bun:test';
import { capsuleToggle } from '../src/capsule-run-style.ts';

describe('reading a modeled toggle out of an rPr capsule', () => {
  test('a bare presence toggle is on', () => {
    expect(capsuleToggle('<w:rPr><w:b/></w:rPr>', 'w:b')).toBe(true);
    expect(capsuleToggle('<w:rPr><w:b /></w:rPr>', 'w:b')).toBe(true);
    expect(capsuleToggle('<w:rPr><w:i/></w:rPr>', 'w:i')).toBe(true);
  });

  test('an explicit-off toggle is off', () => {
    for (const val of ['0', 'false', 'off']) {
      expect(capsuleToggle(`<w:rPr><w:b w:val="${val}"/></w:rPr>`, 'w:b')).toBe(false);
    }
  });

  test('an explicit-on toggle is on', () => {
    for (const val of ['1', 'true', 'on']) {
      expect(capsuleToggle(`<w:rPr><w:b w:val="${val}"/></w:rPr>`, 'w:b')).toBe(true);
    }
  });

  test('a complex-script sibling never satisfies the base toggle', () => {
    // <w:bCs/> is complex-script bold. A prefix match on "<w:b" would wrongly
    // bold every run that only carries bCs.
    expect(capsuleToggle('<w:rPr><w:bCs/></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><w:iCs/></w:rPr>', 'w:i')).toBe(false);
    expect(capsuleToggle('<w:rPr><w:bCs/><w:b/></w:rPr>', 'w:b')).toBe(true);
  });

  test('an absent toggle is off', () => {
    expect(capsuleToggle('<w:rPr><w:color w:val="FF0000"/></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('', 'w:b')).toBe(false);
    expect(capsuleToggle(undefined, 'w:b')).toBe(false);
  });

  test('a realistic capsule resolves both toggles independently', () => {
    const capsule =
      '<w:rPr><w:rFonts w:ascii="Inter"/><w:b/><w:bCs/><w:color w:val="0F172A"/><w:sz w:val="64"/></w:rPr>';
    expect(capsuleToggle(capsule, 'w:b')).toBe(true);
    expect(capsuleToggle(capsule, 'w:i')).toBe(false);
  });

  test('attacker-shaped capsule input cannot hang or mis-report', () => {
    // File-derived text: bounded scanning only, no catastrophic backtracking.
    const hostile = '<w:rPr>' + '<w:bogus '.repeat(5000) + '<w:b/></w:rPr>';
    const started = Date.now();
    expect(capsuleToggle(hostile, 'w:b')).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
    expect(capsuleToggle('<w:b', 'w:b')).toBe(false);
    expect(capsuleToggle('not xml at all', 'w:b')).toBe(false);
  });
});
