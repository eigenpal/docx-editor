import { describe, expect, test } from 'bun:test';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { buildNumberingIndex } from '../numbering-index.ts';
import { createListCounterState } from '../list-counters.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadNumbering(body: string) {
  const result = readOoxmlPart(`<w:numbering xmlns:w="${W}">${body}</w:numbering>`, {
    name: '/word/numbering.xml',
    contentType: 'app/xml',
  });
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
    // Reusing the same numId keeps counting; override is not reapplied.
    expect(state.advance('9', 0)?.markerText).toBe('7.');
  });

  test('nested startOverride restarts at authored start after parent transition', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="9"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="1"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('9', 0)?.markerText).toBe('1.');
    expect(state.advance('9', 1)?.markerText).toBe('5.');
    expect(state.advance('9', 1)?.markerText).toBe('6.');
    expect(state.advance('9', 0)?.markerText).toBe('2.');
    expect(state.advance('9', 1)?.markerText).toBe('5.');
  });

  test('independent numIds keep their own nested startOverride baselines', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="1"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
      <w:num w:numId="2"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="1"><w:startOverride w:val="9"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 1)?.markerText).toBe('5.');
    expect(state.advance('2', 0)?.markerText).toBe('1.');
    expect(state.advance('2', 1)?.markerText).toBe('9.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 1)?.markerText).toBe('5.');
    expect(state.advance('2', 0)?.markerText).toBe('2.');
    expect(state.advance('2', 1)?.markerText).toBe('9.');
  });

  test('startOverride on deep levels restarts after repeated parent transitions', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="2"><w:startOverride w:val="7"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 2)?.markerText).toBe('7.');
    expect(state.advance('1', 2)?.markerText).toBe('8.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 2)?.markerText).toBe('7.');
    expect(state.advance('1', 1)?.markerText).toBe('1.');
    expect(state.advance('1', 2)?.markerText).toBe('7.');
    expect(state.advance('1', 0)?.markerText).toBe('3.');
    expect(state.advance('1', 2)?.markerText).toBe('7.');
  });

  test('default starts restart to one after parent transition', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 1)?.markerText).toBe('a)');
    expect(state.advance('1', 1)?.markerText).toBe('b)');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 1)?.markerText).toBe('a)');
  });

  test('nums sharing an abstractNum maintain independent counter streams', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    // numId 2 shares abstractNum 1 but owns its own counter bag.
    expect(state.advance('2', 0)?.markerText).toBe('1.');
    expect(state.advance('2', 0)?.markerText).toBe('2.');
    // numId 1 continues independently.
    expect(state.advance('1', 0)?.markerText).toBe('3.');
  });

  test('lvlRestart=0 keeps a deeper level running across shallower reuse', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3)"/>
          <w:lvlRestart w:val="0"/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 1)?.markerText).toBe('a)');
    expect(state.advance('1', 2)?.markerText).toBe('i)');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    // level 1 restarts (default), level 2 continues.
    expect(state.advance('1', 1)?.markerText).toBe('a)');
    expect(state.advance('1', 2)?.markerText).toBe('ii)');
  });

  test('lvlRestart one-based trigger restarts when that level is used', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2)"/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3)"/>
          <w:lvlRestart w:val="1"/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 2)?.markerText).toBe('i)');
    // Using level 0 restarts level 2 (trigger level 1 or earlier).
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 2)?.markerText).toBe('i)');
  });

  test('level override start replaces abstract start on first use', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="0">
          <w:lvl w:ilvl="0"><w:start w:val="10"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
            <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        </w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('10.');
    expect(state.advance('1', 0)?.markerText).toBe('11.');
  });

  test('missing definitions fail inertly', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('999', 0)).toBeNull();
    expect(state.advance('1', 9)).toBeNull();
  });

  test('abstract start=0 emits zero then increments', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="0"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('0.');
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
  });

  test('startOverride=0 emits zero then increments', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/>
        <w:lvlOverride w:ilvl="0"><w:startOverride w:val="0"/></w:lvlOverride></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('0.');
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
  });

  test('nested restart restores zero baseline after parent transition', () => {
    const index = loadNumbering(`
      <w:abstractNum w:abstractNumId="1">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="0"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/>
          <w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
    `);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 1)?.markerText).toBe('0.');
    expect(state.advance('1', 1)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 1)?.markerText).toBe('0.');
    expect(state.advance('1', 1)?.markerText).toBe('1.');
  });

  test('ordinary start=1 regression', () => {
    const index = loadNumbering(DECIMAL);
    const state = createListCounterState(index);
    expect(state.advance('1', 0)?.markerText).toBe('1.');
    expect(state.advance('1', 0)?.markerText).toBe('2.');
    expect(state.advance('1', 0)?.markerText).toBe('3.');
  });
});
