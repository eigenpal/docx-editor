import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { createFixedMeasurer } from '../fixed-measurer.ts';
import { buildStyleCascadeTable } from '../style-cascade.ts';
import { layoutHeaderFooterStory } from '../hf-layout.ts';
import { layoutSemanticDocument, createLayoutSession } from '../semantic-layout.ts';
import { parseCharacterStyleField } from '../field-character-style.ts';
import { paragraphFragmentsOfBlocks } from '../semantic-record-queries.ts';
import { characterStyleIndex, characterStylePageValues } from '../character-style-index.ts';
import type { RevisionDisplayMode } from '../revision-projection.ts';
import type { SemanticLayout } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const run = (text: string, style = '') =>
  `<w:r>${style ? `<w:rPr><w:rStyle w:val="${style}"/></w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const p = (text: string, style = '', page = false) =>
  `<w:p>${page ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : ''}${run(text, style)}</w:p>`;
const field = (name: string, suffix = '') =>
  `<w:fldSimple w:instr=" STYLEREF &quot;${name}&quot; ${suffix}">${run('cached')}</w:fldSimple>`;
function part(xml: string, name: string) {
  const parsed = readOoxmlPart(xml, { name, contentType: 'application/xml' });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
const styles = buildStyleCascadeTable(
  part(
    `<w:styles xmlns:w="${W}"><w:style w:type="character" w:styleId="Base"><w:name w:val="Header Source"/></w:style><w:style w:type="character" w:styleId="Derived"><w:name w:val="Derived Source"/><w:basedOn w:val="Base"/></w:style></w:styles>`,
    '/word/styles.xml'
  ).root
);
const measurer = createFixedMeasurer(5, 10);
function fixture(
  body: string,
  header = field('Header Source'),
  displayMode: RevisionDisplayMode = 'all-markup'
) {
  const main = part(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const hdr = part(`<w:hdr xmlns:w="${W}"><w:p>${header}</w:p></w:hdr>`, '/word/header1.xml');
  const story = layoutHeaderFooterStory(hdr, 100, measurer, 'test', undefined, styles);
  const options = {
    measurer,
    displayMode,
    styleCascade: styles,
    geometry: {
      width: 120,
      height: 140,
      margin: { top: 15, bottom: 15, left: 10, right: 10 },
      headerDistance: 5,
    },
    furniture: {
      titlePage: false,
      evenAndOddHeaders: false,
      headers: new Map([['default' as const, story]]),
      footers: new Map(),
    },
  };
  const session = createLayoutSession();
  const before = serializeOoxmlPart(main);
  const laid = layoutSemanticDocument(main, 1, { ...options, session });
  const warm = layoutSemanticDocument(main, 1, { ...options, session });
  expect(text(warm)).toEqual(text(laid));
  for (let i = 0; i < laid.pages.length; i += 1) expect(warm.pages[i]).toBe(laid.pages[i]);
  expect(warm.pages.map((page) => page.contentBox)).toEqual(
    laid.pages.map((page) => page.contentBox)
  );
  expect(serializeOoxmlPart(main)).toBe(before);
  return { laid, main, options, session };
}
function text(layout: SemanticLayout): string[] {
  return layout.pages.map((page) =>
    paragraphFragmentsOfBlocks(page.header?.fragments ?? [])
      .flatMap((f) => f.lines.flatMap((l) => l.spans.map((s) => s.text)))
      .join('')
  );
}

test('first and last character occurrences use the current physical page', () => {
  const { laid } = fixture(
    p('Alpha', 'Base') + p('Omega', 'Base') + p('Next page', '', true),
    field('Header Source') + run('/') + field('Header Source', '\\l')
  );
  expect(text(laid)).toEqual(['Alpha/Omega', 'Omega/Omega']);
});
test('a derived character style does not match the base style field', () => {
  expect(text(fixture(p('Derived', 'Derived') + p('Exact', 'Base')).laid)).toEqual(['Exact']);
});
test('missing style preserves the cached field result', () => {
  expect(text(fixture(p('Plain')).laid)).toEqual(['cached']);
});
test('a page before the first styled occurrence uses the following occurrence', () => {
  expect(text(fixture(p('Plain') + p('Later', 'Base', true)).laid)).toEqual(['Later', 'Later']);
});
test('a page without an occurrence uses the last preceding occurrence', () => {
  expect(
    text(fixture(p('Earlier', 'Base') + p('Plain', '', true) + p('Later', 'Base', true)).laid)
  ).toEqual(['Earlier', 'Earlier', 'Later']);
});
test('unsupported switches preserve cached results', () => {
  expect(text(fixture(p('Live', 'Base'), field('Header Source', '\\n')).laid)).toEqual(['cached']);
  expect(parseCharacterStyleField(' STYLEREF Base \\p ')).toBeNull();
  expect(parseCharacterStyleField(' STYLEREF Base \\* Upper ')).toBeNull();
  expect(parseCharacterStyleField(' STYLEREF "unterminated ')).toBeNull();
  expect(parseCharacterStyleField(' STYLEREF ' + 'x'.repeat(5000))).toBeNull();
});
test('a longer header increases only the page-local body inset', () => {
  const { laid } = fixture(
    p('A long character title that fills several header lines', 'Base') + p('Short', 'Base', true)
  );
  expect(laid.pages[0]!.contentBox.y).toBeGreaterThan(
    laid.pages[1]!.contentBox.y - laid.pages[1]!.box.y
  );
  expect(text(laid)).toEqual(['A long character title that fills several header lines', 'Short']);
});
test('complex fields without cached results retain their one-unit source range', () => {
  const complex =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> STYLEREF &quot;Header Source&quot; </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const { laid } = fixture(p('Resolved', 'Base'), complex + run(' suffix'));
  expect(text(laid)).toEqual(['Resolved suffix']);
  const spans = paragraphFragmentsOfBlocks(laid.pages[0]!.header!.fragments)[0]!.lines[0]!.spans;
  expect(spans.find((s) => s.text === 'Resolved')?.range).toMatchObject({ start: 0, end: 1 });
});

for (const mode of ['proposed', 'original', 'all-markup'] as const) {
  test(`style lookup follows visible revisions (${mode})`, () => {
    const deleted =
      '<w:del w:id="1" w:author="A">' +
      run('Old', 'Base').replace('<w:t ', '<w:delText ').replace('</w:t>', '</w:delText>') +
      '</w:del>';
    const inserted = '<w:ins w:id="2" w:author="A">' + run('New', 'Base') + '</w:ins>';
    expect(
      text(fixture('<w:p>' + deleted + inserted + '</w:p>', field('Header Source'), mode).laid)
    ).toEqual([mode === 'proposed' ? 'New' : mode === 'original' ? 'Old' : 'OldNew']);
  });
}
test('hidden runs and field instruction text do not supply header text', () => {
  const hidden = '<w:r><w:rPr><w:rStyle w:val="Base"/><w:vanish/></w:rPr><w:t>Hidden</w:t></w:r>';
  const instruction =
    '<w:r><w:rPr><w:rStyle w:val="Base"/></w:rPr><w:instrText>Secret</w:instrText></w:r>';
  expect(
    text(fixture('<w:p>' + hidden + instruction + run('Visible', 'Base') + '</w:p>').laid)
  ).toEqual(['Visible']);
});
test('a body edit refreshes header values in the same layout session', () => {
  const f = fixture(p('Old', 'Base'));
  const changed = part(
    `<w:document xmlns:w="${W}"><w:body>${p('Changed', 'Base')}</w:body></w:document>`,
    '/word/document.xml'
  );
  const warm = layoutSemanticDocument(changed, 2, { ...f.options, session: f.session });
  const cold = layoutSemanticDocument(changed, 2, f.options);
  expect(text(warm)).toEqual(['Changed']);
  expect(text(warm)).toEqual(text(cold));
});
test('unsupported outer fields retain their nested PAGE result', () => {
  const unsupported =
    '<w:fldSimple w:instr=" STYLEREF &quot;Header Source&quot; \\n ">' +
    run('cached ') +
    '<w:fldSimple w:instr=" PAGE ">' +
    run('99') +
    '</w:fldSimple></w:fldSimple>';
  expect(text(fixture(p('Live', 'Base') + p('Next', '', true), unsupported).laid)).toEqual([
    'cached 1',
    'cached 2',
  ]);
});
test('an oversized contiguous styled occurrence never exposes a partial result', () => {
  const f = fixture(p('Short', 'Base'));
  const huge = part(
    `<w:document xmlns:w="${W}"><w:body><w:p>${run('a'.repeat(3000), 'Base')}${run('b'.repeat(3000), 'Base')}</w:p></w:body></w:document>`,
    '/word/document.xml'
  );
  const index = characterStyleIndex(huge, f.options)!;
  const values = characterStylePageValues(index, f.laid, [
    parseCharacterStyleField('STYLEREF "Header Source"')!,
    parseCharacterStyleField('STYLEREF "Header Source" \\l')!,
  ]);
  expect(values[0]!.size).toBe(0);
});
test('a body scan limit refuses incomplete fallback selection', () => {
  const f = fixture(p('Short', 'Base'));
  let root = f.main.root;
  for (let n = 0; n < 66; n += 1) root = { ...root, children: [root] };
  expect(() => characterStyleIndex({ ...f.main, root }, f.options)).toThrow('scan bound');
});
test('section page restarts preserve logical PAGE and physical even-header selection', () => {
  const f = fixture(p('Seed', 'Base'));
  const pageField = '<w:fldSimple w:instr=" PAGE ">' + run('99') + '</w:fldSimple>';
  const header = (prefix: string) =>
    layoutHeaderFooterStory(
      part(
        `<w:hdr xmlns:w="${W}"><w:p>${run(prefix)}${field('Header Source')}${run('/')}${pageField}</w:p></w:hdr>`,
        '/word/header' + prefix + '.xml'
      ),
      100,
      measurer,
      'test',
      undefined,
      styles
    );
  const furniture = {
    ...f.options.furniture,
    evenAndOddHeaders: true,
    headers: new Map([
      ['default' as const, header('D')],
      ['even' as const, header('E')],
    ]),
  };
  const sect = (start: number) =>
    `<w:sectPr><w:pgSz w:w="2400" w:h="2800"/><w:pgMar w:top="300" w:bottom="300" w:left="200" w:right="200" w:header="100"/><w:pgNumType w:start="${start}"/></w:sectPr>`;
  const body =
    p('Alpha', 'Base') + '<w:p><w:pPr>' + sect(3) + '</w:pPr></w:p>' + p('Beta', 'Base') + sect(12);
  const main = part(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    '/word/document.xml'
  );
  const options = { ...f.options, sectionFurniture: [furniture, furniture] };
  const laid = layoutSemanticDocument(main, 1, options);
  expect(text(laid)).toEqual(['DAlpha/3', 'EBeta/12']);
  const session = createLayoutSession();
  const warm = layoutSemanticDocument(main, 1, { ...options, session });
  const repeated = layoutSemanticDocument(main, 1, { ...options, session });
  expect(text(repeated)).toEqual(text(laid));
  for (let i = 0; i < warm.pages.length; i += 1) expect(repeated.pages[i]).toBe(warm.pages[i]);
});
test('nested PAGE stays live inside an otherwise recognized character-style field', () => {
  const simple =
    '<w:fldSimple w:instr=" STYLEREF &quot;Header Source&quot; ">' +
    run('cached ') +
    '<w:fldSimple w:instr=" PAGE ">' +
    run('99') +
    '</w:fldSimple></w:fldSimple>';
  expect(text(fixture(p('Live', 'Base') + p('Next', '', true), simple).laid)).toEqual([
    'cached 1',
    'cached 2',
  ]);
  const complex =
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> STYLEREF &quot;Header Source&quot; </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    run('cached ') +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>' +
    run('99') +
    '<w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  expect(text(fixture(p('Live', 'Base') + p('Next', '', true), complex).laid)).toEqual([
    'cached 1',
    'cached 2',
  ]);
});
test('a cyclic header-height boundary fails with an explicit convergence error', () => {
  const body =
    p('Prior', 'Base') +
    Array.from({ length: 7 }, () => p('filler')).join('') +
    '<w:p><w:pPr><w:keepLines/></w:pPr>' +
    run('A long styled title with enough words to fill three lines', 'Base') +
    '</w:p>';
  expect(() => fixture(body, field('Header Source', '\\l'))).toThrow(
    'character-style header layout'
  );
});

test('a style identifier does not replace its display name', () => {
  expect(text(fixture(p('Live', 'Base'), field('Base')).laid)).toEqual(['cached']);
});

for (const [start, format] of [
  [9999, 'decimal'],
  [888, 'upperRoman'],
] as const) {
  test(`logical PAGE ${start} ${format} reserves its final header height`, () => {
    const header =
      field('Header Source') +
      run(' ') +
      '<w:fldSimple w:instr=" PAGE ">' +
      run('1') +
      '</w:fldSimple>';
    const sect = `<w:sectPr><w:pgNumType w:start="${start}" w:fmt="${format}"/></w:sectPr>`;
    const { laid } = fixture(p('Alpha Beta GammaZZ', 'Base') + p('Body content') + sect, header);
    const page = laid.pages[0]!;
    expect(page.header!.box.height).toBeGreaterThan(10);
    expect(page.header!.box.y + page.header!.box.height).toBeLessThanOrEqual(
      page.contentBox.y + 0.001
    );
  });
}

test('the character query bound covers all header parts together', () => {
  const f = fixture(p('Plain'));
  const definitions = Array.from(
    { length: 129 },
    (_, i) => `<w:style w:type="character" w:styleId="S${i}"><w:name w:val="Style ${i}"/></w:style>`
  ).join('');
  const cascade = buildStyleCascadeTable(
    part(`<w:styles xmlns:w="${W}">${definitions}</w:styles>`, '/word/styles.xml').root
  );
  const story = (start: number, count: number) =>
    layoutHeaderFooterStory(
      part(
        `<w:hdr xmlns:w="${W}"><w:p>${Array.from({ length: count }, (_, i) => field(`Style ${start + i}`)).join('')}</w:p></w:hdr>`,
        `/word/header${start}.xml`
      ),
      100,
      measurer,
      'test',
      undefined,
      cascade
    );
  const furniture = {
    ...f.options.furniture,
    headers: new Map([
      ['default' as const, story(0, 65)],
      ['even' as const, story(65, 64)],
    ]),
  };
  expect(() =>
    layoutSemanticDocument(f.main, 1, { ...f.options, styleCascade: cascade, furniture })
  ).toThrow('queries exceed their bound');
});

test('a visible merged paragraph retains the second paragraph style occurrence', () => {
  const body =
    '<w:p><w:pPr><w:rPr><w:del w:id="1" w:author="A"/></w:rPr></w:pPr>' +
    run('Prefix ') +
    '</w:p>' +
    p('Merged title', 'Base');
  expect(text(fixture(body, field('Header Source'), 'proposed').laid)).toEqual(['Merged title']);
});
