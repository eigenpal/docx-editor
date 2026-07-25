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

  test('a hostile-shaped capsule cannot hang the scan', () => {
    // Bounded walk, no backtracking regex. Narrow by design: the mis-report
    // vectors are covered by the suite below, and the DoS amplification is
    // covered by the layout-cost test, because the real cost lived in the
    // per-character call site rather than in one call.
    const hostile = '<w:rPr>' + '<w:bogus '.repeat(5000) + '<w:b/></w:rPr>';
    const started = Date.now();
    expect(capsuleToggle(hostile, 'w:b')).toBe(true);
    expect(Date.now() - started).toBeLessThan(200);
    expect(capsuleToggle('<w:b', 'w:b')).toBe(false);
    expect(capsuleToggle('not xml at all', 'w:b')).toBe(false);
  });
});

describe('capsules crafted to disagree with Word (independent security review)', () => {
  // Each case below was demonstrated by the reviewer against the previous
  // implementation, and each is accepted verbatim by the parse boundary — so a
  // real .docx can carry it.

  test('a raw > inside an attribute value does not hide w:val', () => {
    // Previously reported ON: indexOf('>') truncated the element before w:val.
    expect(capsuleToggle('<w:rPr><w:b w:x="a>b" w:val="0"/></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><w:b w:x="a>b"/></w:rPr>', 'w:b')).toBe(true);
  });

  test('XML whitespace after the element name still terminates it', () => {
    // Previously reported OFF: only space, > and / were accepted terminators, so
    // `<w:b\n/>` read as a longer element name.
    for (const ws of ['\n', '\t', '\r\n', ' ']) {
      expect(capsuleToggle(`<w:rPr><w:b${ws}/></w:rPr>`, 'w:b')).toBe(true);
    }
  });

  test('a character entity in w:val is decoded before comparison', () => {
    // &#48; is '0' — an OFF toggle that previously read as ON.
    expect(capsuleToggle('<w:rPr><w:b w:val="&#48;"/></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><w:b w:val="&#x30;"/></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><w:b w:val="&#49;"/></w:rPr>', 'w:b')).toBe(true);
  });

  test('a toggle inside a comment or CDATA is not a toggle', () => {
    expect(capsuleToggle('<w:rPr><!-- <w:b/> --></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><![CDATA[<w:b/>]]></w:rPr>', 'w:b')).toBe(false);
    // A real toggle alongside a decoy still counts.
    expect(capsuleToggle('<w:rPr><!-- x --><w:b/></w:rPr>', 'w:b')).toBe(true);
    // Unterminated comment must not loop or read past the end.
    expect(capsuleToggle('<w:rPr><!-- <w:b/>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><![CDATA[<w:b/>', 'w:b')).toBe(false);
  });

  test('duplicate toggles are last-wins, as OOXML specifies', () => {
    // Previously first-wins, which inverted both of these.
    expect(capsuleToggle('<w:rPr><w:b w:val="0"/><w:b/></w:rPr>', 'w:b')).toBe(true);
    expect(capsuleToggle('<w:rPr><w:b/><w:b w:val="0"/></w:rPr>', 'w:b')).toBe(false);
  });

  test('a w:val inside another attribute value is not read as the toggle value', () => {
    // Previously reported OFF from the nested text.
    expect(capsuleToggle(`<w:rPr><w:b w:foo="w:val='0'"/></w:rPr>`, 'w:b')).toBe(true);
  });

  test('single-quoted attribute values are handled', () => {
    expect(capsuleToggle("<w:rPr><w:b w:val='0'/></w:rPr>", 'w:b')).toBe(false);
    expect(capsuleToggle("<w:rPr><w:b w:val='1'/></w:rPr>", 'w:b')).toBe(true);
  });

  test('bCs and iCs still never satisfy the base toggle', () => {
    expect(capsuleToggle('<w:rPr><w:bCs/></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><w:iCs w:val="1"/></w:rPr>', 'w:i')).toBe(false);
    expect(capsuleToggle('<w:rPr><w:bCs/><w:b/></w:rPr>', 'w:b')).toBe(true);
  });

  test('a realistic Word capsule still resolves both toggles', () => {
    const capsule =
      '<w:rPr><w:rFonts w:ascii="Inter" w:hAnsi="Inter"/><w:b/><w:bCs/><w:color w:val="0F172A"/><w:sz w:val="64"/></w:rPr>';
    expect(capsuleToggle(capsule, 'w:b')).toBe(true);
    expect(capsuleToggle(capsule, 'w:i')).toBe(false);
  });
});

describe('vectors found by the second security pass', () => {
  test('w:rPrChange history does not override current formatting', () => {
    // ECMA-376 17.13.5.31: w:rPrChange holds the run's PREVIOUS properties for a
    // tracked change. Reported ON because the flat scan saw the nested w:b and
    // last-wins let history beat the live value. This shape needs no attacker —
    // it is what Word writes for a tracked formatting change.
    const capsule =
      '<w:rPr><w:b w:val="0"/><w:rPrChange w:id="1" w:author="A"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr>';
    expect(capsuleToggle(capsule, 'w:b')).toBe(false);
    // And the reverse: currently bold, previously not.
    const nowBold =
      '<w:rPr><w:b/><w:rPrChange w:id="1" w:author="A"><w:rPr><w:b w:val="0"/></w:rPr></w:rPrChange></w:rPr>';
    expect(capsuleToggle(nowBold, 'w:b')).toBe(true);
  });

  test('an unterminated w:rPrChange does not leak history as current', () => {
    expect(capsuleToggle('<w:rPr><w:b w:val="0"/><w:rPrChange><w:rPr><w:b/>', 'w:b')).toBe(false);
  });

  test('a processing instruction is not an element', () => {
    expect(capsuleToggle('<w:rPr><?p <w:b/>?></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><?p x?><w:b/></w:rPr>', 'w:b')).toBe(true);
    expect(capsuleToggle('<w:rPr><?p <w:b/>', 'w:b')).toBe(false);
  });

  test('a toggle spelled inside another attribute value is not markup', () => {
    // The outer walk was not quote-aware, only elementEnd was.
    expect(capsuleToggle('<w:rPr><w:rFonts w:ascii="<w:b/>"/></w:rPr>', 'w:b')).toBe(false);
    expect(capsuleToggle('<w:rPr><w:rFonts w:ascii="<w:b/>"/><w:b/></w:rPr>', 'w:b')).toBe(true);
  });

  test('the added skips cannot hang on pathological input', () => {
    const started = Date.now();
    expect(capsuleToggle('<w:rPr>' + '<?p x?>'.repeat(50_000) + '<w:b/></w:rPr>', 'w:b')).toBe(true);
    expect(capsuleToggle('<w:rPr>' + '"a"'.repeat(50_000) + '<w:b/></w:rPr>', 'w:b')).toBe(true);
    expect(capsuleToggle('<w:rPr>' + '<w:rPrChange><w:rPr><w:b/></w:rPr></w:rPrChange>'.repeat(5_000) + '</w:rPr>', 'w:b')).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
