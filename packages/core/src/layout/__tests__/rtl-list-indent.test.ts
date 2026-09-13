import { expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlProperty } from '../../store/index.ts';
import { buildNumberingIndex, resolveNumberingLevel } from '../numbering-index.ts';
import { mergeListIndent } from '../list-resolve.ts';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const bidi: OoxmlProperty = { localName: 'bidi' };
const ind = (attributes: Record<string, string>): OoxmlProperty => ({
  localName: 'ind',
  attributes,
});
function level(attrs: string) {
  const p = readOoxmlPart(
    `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind ${attrs}/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    { name: '/word/numbering.xml', contentType: 'app/xml' }
  );
  if (!p.ok) throw Error(p.reason);
  return resolveNumberingLevel(buildNumberingIndex(p.part.root), '1', 0)!.level.indent;
}
test('direct logical indents use inherited bidi and override numbering physical sides', () => {
  expect(
    mergeListIndent(level('w:right="720"'), [bidi], [ind({ start: '1440', end: '360' })])
  ).toMatchObject({ left: 18, right: 72 });
  expect(mergeListIndent(level('w:right="720"'), [], [bidi, ind({ start: '1440' })])).toMatchObject(
    { left: 0, right: 72 }
  );
});
test('inherited logical indents follow final direct paragraph direction', () => {
  expect(
    mergeListIndent(level('w:hanging="360"'), [ind({ start: '1440', end: '360' })], [bidi])
  ).toMatchObject({ left: 18, right: 72 });
  expect(
    mergeListIndent(
      level('w:hanging="360"'),
      [bidi, ind({ start: '1440', end: '360' })],
      [{ localName: 'bidi', attributes: { val: 'off' } }]
    )
  ).toMatchObject({ left: 72, right: 18 });
});
test('numbering levels preserve logical provenance until final paragraph direction', () => {
  const raw = level('w:start="720" w:end="360"');
  expect(raw).toMatchObject({ left: 36, right: 18, authored: { start: 36, end: 18 } });
  expect(mergeListIndent(raw, [bidi])).toMatchObject({ left: 18, right: 36 });
  expect(mergeListIndent(raw, [])).toMatchObject({ left: 36, right: 18 });
});
test('physical sides take precedence over logical sides within each tier', () => {
  const raw = level('w:left="240" w:right="480" w:start="720" w:end="360"');
  expect(mergeListIndent(raw, [bidi])).toMatchObject({ left: 12, right: 24 });
  expect(
    mergeListIndent(
      level('w:start="720"'),
      [bidi],
      [ind({ left: '200', right: '400', start: '800', end: '600' })]
    )
  ).toMatchObject({ left: 10, right: 20 });
});
test('numbering logical sides override inherited indents on their resolved physical side', () => {
  expect(
    mergeListIndent(level('w:start="720"'), [bidi, ind({ left: '180', right: '1440' })])
  ).toMatchObject({ left: 9, right: 36 });
  expect(
    mergeListIndent(level('w:end="720"'), [bidi, ind({ left: '1440', right: '180' })])
  ).toMatchObject({ left: 36, right: 9 });
});
