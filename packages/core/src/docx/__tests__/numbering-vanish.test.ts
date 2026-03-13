import { describe, test, expect } from 'bun:test';
import { parseNumbering } from '../numberingParser';

const NUMBERING_WITH_VANISH = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/>
      <w:rPr>
        <w:vanish/>
      </w:rPr>
    </w:lvl>
    <w:lvl w:ilvl="1">
      <w:start w:val="1"/>
      <w:numFmt w:val="decimal"/>
      <w:lvlText w:val="%2."/>
      <w:lvlJc w:val="left"/>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;

const NUMBERING_WITH_VANISH_FALSE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="•"/>
      <w:lvlJc w:val="left"/>
      <w:rPr>
        <w:vanish w:val="false"/>
      </w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;

describe('Numbering vanish (hidden list indicators)', () => {
  test('parses w:vanish on level rPr as hidden=true', () => {
    const numbering = parseNumbering(NUMBERING_WITH_VANISH);
    const level0 = numbering.getLevel(1, 0);
    expect(level0).toBeDefined();
    expect(level0!.rPr?.hidden).toBe(true);
  });

  test('level without w:vanish has no hidden flag', () => {
    const numbering = parseNumbering(NUMBERING_WITH_VANISH);
    const level1 = numbering.getLevel(1, 1);
    expect(level1).toBeDefined();
    expect(level1!.rPr?.hidden).toBeUndefined();
  });

  test('w:vanish val="false" parses as hidden=false', () => {
    const numbering = parseNumbering(NUMBERING_WITH_VANISH_FALSE);
    const level0 = numbering.getLevel(1, 0);
    expect(level0).toBeDefined();
    expect(level0!.rPr?.hidden).toBe(false);
  });
});
