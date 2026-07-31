import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core-contract/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createListCounterState } from '../list-counters.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadNumbering(body: string) {
  const result = readOoxmlPart(
    `<w:numbering xmlns:w="${W}">${body}</w:numbering>`,
    { name: '/word/numbering.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return buildNumberingIndex(result.part.root);
}

const DECIMAL = `
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/>
      <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/>
    <w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
`;

describe('list counters', () => {
  test('increments and formats nested levels', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 1)?.markerText).toBe('a)');
    expect(state.advance('1', 1)?.markerText).toBe('b)');
    expect(state.advance('1', 0)?.markerText).toBe('3.');
    // Deeper level restarted after returning to level 0.
    expect(state.advance('1', 1)?.markerText).toBe('a)');
  });

  test('startOverride applies only on first encounter of a numId', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="9"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('9', 0)?.markerText).toBe('5.');
    expect(state.advance('9', 0)?.markerText).toBe('6.');
  });

  test('nums sharing an abstractNum share counter state', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    // numId 2 shares abstractNum 1 — continues, but its own startOverride fires once.
    // First encounter of numId=2 applies startOverride=1, resetting the shared level.
    expect(state.advance('2', 0)?.markerText).toBe('1.');
    expect(state.advance('2', 0)?.markerText).toBe('2.');
  });

  test('missing definitions fail inertly', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('999', 0)).toBeNull();
    expect(state.advance('1', 9)).toBeNull();
  });
});
