// The read rebuilds the shapes that would otherwise hide their content: properties out of
// place or repeated, text holding elements, an insertion inside a run, a stray `w:val`, a
// paragraph written straight into a row, and run content or properties where they apply to
// nothing. Each case saves in its rebuilt shape and reads back the same.
import { describe, expect, test } from 'bun:test';
import {
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const META = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`,
    META
  );
  if (!result.ok) throw new Error(`document read failed: ${result.reason}`);
  return result.part;
}

function elements(part: OoxmlPart, localName: string): OoxmlElement[] {
  const found: OoxmlElement[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.localName === localName) found.push(node);
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

function kinds(node: OoxmlNode): string[] {
  if (node.kind === 'textValue') return [];
  return [`${node.localName}:${node.kind}`, ...node.children.flatMap(kinds)];
}

const childKinds = (node: OoxmlElement) =>
  node.children.map((child) =>
    child.kind === 'textValue' ? 'textValue' : `${child.localName}:${child.kind}`
  );

/** The saved body, between `w:body` and its final `w:sectPr`. */
function savedBody(part: OoxmlPart): string {
  const xml = serializeOoxmlPart(part);
  return xml.slice(xml.indexOf('<w:body>') + '<w:body>'.length, xml.lastIndexOf('<w:sectPr/>'));
}

/** A save reads back to the same save. */
function expectStable(part: OoxmlPart): void {
  const saved = serializeOoxmlPart(part);
  const reread = readOoxmlPart(saved, META);
  if (!reread.ok) throw new Error(reread.reason);
  expect(serializeOoxmlPart(reread.part)).toBe(saved);
}

describe('paragraph properties', () => {
  test('a second w:pPr stays generic, its section break included, and saves where it stood', () => {
    const part = parse(
      '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
        '<w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
        '<w:r><w:t>Doubled</w:t></w:r></w:p>'
    );
    const [paragraph] = elements(part, 'p');
    expect(paragraph!.kind).toBe('paragraph');
    expect(paragraph!.children.map((child) => child.kind)).toEqual([
      'paragraphProperties',
      'generic',
      'run',
    ]);
    expect(kinds(paragraph!.children[1]!).every((entry) => entry.endsWith(':generic'))).toBe(true);
    expect(savedBody(part)).toContain('</w:pPr><w:pPr><w:sectPr>');
    expectStable(part);
  });

  test('after empty markers, the w:pPr leads and keeps its section break', () => {
    const part = parse(
      '<w:p><w:bookmarkStart w:id="1" w:name="b"/><w:proofErr w:type="spellStart"/>' +
        '<w:pPr><w:jc w:val="center"/><w:sectPr/></w:pPr>' +
        '<w:r><w:t>Marked</w:t></w:r><w:bookmarkEnd w:id="1"/></w:p>'
    );
    const [paragraph] = elements(part, 'p');
    expect(childKinds(paragraph!)).toEqual([
      'pPr:paragraphProperties',
      'bookmarkStart:bookmarkStart',
      'proofErr:generic',
      'r:run',
      'bookmarkEnd:bookmarkEnd',
    ]);
    expect(kinds(paragraph!.children[0]!)).toContain('sectPr:generic');
    expectStable(part);
  });

  test('after content, the w:pPr applies to nothing and stays generic behind an empty one', () => {
    const part = parse(
      '<w:p><w:r><w:t>Late</w:t></w:r><w:pPr><w:jc w:val="right"/><w:sectPr/></w:pPr></w:p>'
    );
    const [paragraph] = elements(part, 'p');
    expect(paragraph!.kind).toBe('paragraph');
    expect(childKinds(paragraph!)).toEqual(['pPr:paragraphProperties', 'r:run', 'pPr:generic']);
    expect(
      paragraph!.children[0]!.kind !== 'textValue' && paragraph!.children[0]!.children
    ).toEqual([]);
    expect(savedBody(part)).toBe(
      '<w:p><w:pPr/><w:r><w:t>Late</w:t></w:r><w:pPr><w:jc w:val="right"/><w:sectPr/></w:pPr></w:p>'
    );
    expectStable(part);
  });
});

describe('run properties', () => {
  test('after a saved page break, the w:rPr leads in the same run', () => {
    const part = parse(
      '<w:p><w:r><w:lastRenderedPageBreak/><w:rPr><w:b/></w:rPr><w:t>Lead</w:t></w:r></w:p>'
    );
    const [run] = elements(part, 'r');
    expect(childKinds(run!)).toEqual([
      'rPr:runProperties',
      'lastRenderedPageBreak:generic',
      't:text',
    ]);
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:lastRenderedPageBreak/><w:t>Lead</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('after content, the run splits and the content before has no properties', () => {
    const part = parse(
      '<w:p><w:r><w:tab/><w:rPr><w:b/></w:rPr><w:t>After</w:t></w:r>' +
        '<w:r><w:t>Before</w:t><w:rPr><w:i/></w:rPr></w:r></w:p>'
    );
    expect(elements(part, 'r').map((run) => run.kind)).toEqual(['run', 'run', 'run', 'run']);
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:tab/></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>After</w:t></w:r>' +
        '<w:r><w:t>Before</w:t></w:r><w:r><w:rPr><w:i/></w:rPr></w:r></w:p>'
    );
    expectStable(part);
  });

  test('a later w:rPr adds to the earlier one, winning where both name a property', () => {
    const part = parse(
      '<w:p><w:r><w:rPr><w:i/><w:sz w:val="56"/></w:rPr><w:t>A</w:t>' +
        '<w:rPr><w:sz w:val="20"/><w:b/></w:rPr><w:t>B</w:t></w:r></w:p>'
    );
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:rPr><w:i/><w:sz w:val="56"/></w:rPr><w:t>A</w:t></w:r>' +
        '<w:r><w:rPr><w:b/><w:i/><w:sz w:val="20"/></w:rPr><w:t>B</w:t></w:r></w:p>'
    );
    // Every node keeps its own id.
    const ids = new Set<string>();
    const visit = (node: OoxmlNode): void => {
      expect(ids.has(node.id)).toBe(false);
      ids.add(node.id);
      if (node.kind !== 'textValue') node.children.forEach(visit);
    };
    visit(part.root);
    expectStable(part);
  });
});

describe('run content', () => {
  test('a w:t holding elements splits around them, and a w:br among them breaks the line', () => {
    const part = parse('<w:p><w:r><w:t>A<w:br/>B<w:x/>C</w:t></w:r></w:p>');
    const [run] = elements(part, 'r');
    expect(run!.kind).toBe('run');
    expect(childKinds(run!)).toEqual(['t:text', 'br:hardBreak', 't:text', 't:generic', 't:text']);
    // The other element stays inside a text element, where it shows nothing.
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t><w:t><w:x/></w:t><w:t>C</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('a w:ins inside a run becomes a tracked insertion beside it', () => {
    const part = parse(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t>' +
        '<w:ins w:id="9" w:author="a"><w:t>B</w:t></w:ins><w:t>C</w:t></w:r></w:p>'
    );
    const [paragraph] = elements(part, 'p');
    expect(childKinds(paragraph!)).toEqual(['r:run', 'ins:revisionInsert', 'r:run']);
    expect(savedBody(part)).toBe(
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>A</w:t></w:r>' +
        '<w:ins w:author="a" w:id="9"><w:r><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r></w:ins>' +
        '<w:r><w:rPr><w:b/></w:rPr><w:t>C</w:t></w:r></w:p>'
    );
    expectStable(part);
  });

  test('run content, w:pPr and w:rPr where they apply to nothing stay generic in place', () => {
    const part = parse(
      '<w:p><w:tab/><w:r><w:t>Tab</w:t></w:r></w:p>' +
        '<w:p><w:hyperlink w:anchor="x"><w:pPr><w:jc w:val="center"/></w:pPr>' +
        '<w:r><w:t>Link</w:t></w:r></w:hyperlink></w:p>' +
        '<w:p><w:ins w:id="1" w:author="a"><w:rPr><w:b/></w:rPr><w:r><w:t>Ins</w:t></w:r></w:ins></w:p>'
    );
    const [tab, link, insertion] = elements(part, 'p');
    expect(childKinds(tab!)).toEqual(['tab:generic', 'r:run']);
    expect(childKinds(link!)).toEqual(['hyperlink:hyperlink']);
    expect(childKinds(insertion!)).toEqual(['ins:revisionInsert']);
    expectStable(part);
  });

  test('a stray w:val keeps the paragraph, run, text, table and link typed', () => {
    const body =
      '<w:p w:val="1"><w:hyperlink w:anchor="x" w:val="2"><w:r w:val="3"><w:t w:val="4">V</w:t>' +
      '</w:r></w:hyperlink></w:p><w:tbl w:val="5"><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
      '<w:tr w:val="6"><w:tc w:val="7"><w:p><w:r><w:t>C</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const part = parse(body);
    const all = kinds(part.root);
    for (const name of ['p', 'hyperlink', 'r', 't', 'tbl', 'tr', 'tc'])
      expect(all.filter((entry) => entry.startsWith(`${name}:`))).not.toContainEqual(
        `${name}:generic`
      );
    expect(savedBody(part)).toBe(body);
  });
});

describe('tables', () => {
  test('two w:tblPr merge into the first, the later winning, and a second grid stays generic', () => {
    const part = parse(
      '<w:tbl><w:tblPr><w:jc w:val="right"/><w:tblW w:w="2000" w:type="dxa"/></w:tblPr>' +
        '<w:tblPr><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
        '<w:tblGrid><w:gridCol w:w="1500"/></w:tblGrid><w:tblGrid><w:gridCol w:w="6000"/></w:tblGrid>' +
        '<w:tr><w:tc><w:p><w:r><w:t>T</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
    );
    const [table] = elements(part, 'tbl');
    expect(childKinds(table!)).toEqual([
      'tblPr:tableProperties',
      'tblGrid:tableGrid',
      'tblGrid:generic',
      'tr:tableRow',
    ]);
    expect(savedBody(part)).toContain(
      '<w:tblPr><w:tblW w:type="dxa" w:w="4000"/><w:jc w:val="right"/></w:tblPr>'
    );
    expectStable(part);
  });

  test('a paragraph written straight into a row joins the next cell, or stays generic after the last', () => {
    const part = parse(
      '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid><w:tr>' +
        '<w:tc><w:p><w:r><w:t>One</w:t></w:r></w:p></w:tc><w:p><w:r><w:t>Stray</w:t></w:r></w:p>' +
        '<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Two</w:t></w:r></w:p></w:tc>' +
        '<w:p><w:r><w:t>Trailing</w:t></w:r></w:p></w:tr></w:tbl>'
    );
    const [row] = elements(part, 'tr');
    expect(row!.kind).toBe('tableRow');
    expect(childKinds(row!)).toEqual(['tc:tableCell', 'tc:tableCell', 'p:generic']);
    const second = row!.children[1] as OoxmlElement;
    expect(childKinds(second)).toEqual(['tcPr:generic', 'p:paragraph', 'p:paragraph']);
    expectStable(part);
  });
});
