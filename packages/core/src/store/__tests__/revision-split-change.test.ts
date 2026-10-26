import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, serializeOoxmlPart, type OoxmlPart } from '../index.ts';

// One change can sit in several runs or adjacent wrappers, split where another edit fell, while
// a peer holds the same change as one run. The two must decide and take typing alike.

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function part(paragraph: string): OoxmlPart {
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p>${paragraph}</w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

function paragraphOf(xml: string): string {
  return xml.slice(xml.indexOf('<w:p>') + 5, xml.indexOf('</w:p>'));
}

const deletion = (inner: string) =>
  `<w:del w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z">${inner}</w:del>`;
const insertion = (inner: string) =>
  `<w:ins w:id="7" w:author="A" w:date="2026-01-01T00:00:00Z">${inner}</w:ins>`;
const REJECT = {
  op: 'rejectRevision',
  revision: { id: '7', author: 'A', date: '2026-01-01T00:00:00Z' },
  localName: 'del',
} as const;
const ACCEPT = {
  op: 'acceptRevision',
  revision: { id: '7', author: 'A', date: '2026-01-01T00:00:00Z' },
  localName: 'ins',
} as const;

function decided(paragraph: string, op: typeof REJECT | typeof ACCEPT): string {
  const result = applyTreeOp(part(paragraph), op);
  if (!result.ok || !result.part) throw new Error(result.reason);
  return paragraphOf(serializeOoxmlPart(result.part));
}

test('rejecting a deletion held as two runs or two wrappers gives one run', () => {
  const one = decided(
    `<w:r><w:t>a</w:t></w:r>${deletion('<w:r><w:delText xml:space="preserve"> d </w:delText></w:r>')}`,
    REJECT
  );
  const runs = decided(
    `<w:r><w:t>a</w:t></w:r>${deletion(
      '<w:r><w:delText xml:space="preserve"> d</w:delText></w:r>' +
        '<w:r><w:delText xml:space="preserve"> </w:delText></w:r>'
    )}`,
    REJECT
  );
  const wrappers = decided(
    `<w:r><w:t>a</w:t></w:r>${deletion('<w:r><w:delText xml:space="preserve"> d</w:delText></w:r>')}${deletion(
      '<w:r><w:delText xml:space="preserve"> </w:delText></w:r>'
    )}`,
    REJECT
  );
  expect(one).toContain('<w:t xml:space="preserve"> d </w:t>');
  expect(runs).toBe(one);
  expect(wrappers).toBe(one);
});

test('accepting an insertion joins a run that holds a break with the next run', () => {
  const one = decided(insertion('<w:r><w:t>do</w:t><w:br/><w:t>lo!</w:t></w:r>'), ACCEPT);
  const split = decided(
    insertion('<w:r><w:t>do</w:t><w:br/><w:t>lo</w:t></w:r>') +
      insertion('<w:r><w:t>!</w:t></w:r>'),
    ACCEPT
  );
  expect(split).toBe(one);
});

test('a decision does not join runs of different formats or outside the change', () => {
  const kept = decided(
    `<w:r><w:t>a</w:t></w:r>${deletion(
      '<w:r><w:delText>b</w:delText></w:r><w:r><w:rPr><w:b/></w:rPr><w:delText>c</w:delText></w:r>'
    )}<w:r><w:t>d</w:t></w:r>`,
    REJECT
  );
  expect(kept).toBe(
    '<w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t>c</w:t></w:r><w:r><w:t>d</w:t></w:r>'
  );
});

test('typing between two wrappers of one insertion lands as typing inside one wrapper does', () => {
  const typed = (paragraph: string): string => {
    const source = part(paragraph);
    const paragraphId = (source.root as { children: { children: { id: string }[] }[] }).children[0]!
      .children[0]!.id;
    const result = applyTreeOp(source, { op: 'insertText', paragraphId, offset: 4, text: 'X' });
    if (!result.ok || !result.part) throw new Error(result.reason);
    // Only the wrapper boundary is not asserted: one change, in one wrapper or two.
    return paragraphOf(serializeOoxmlPart(result.part)).replace(/<\/w:ins><w:ins [^>]*>/g, '');
  };
  const controls = [
    (inner: string) => inner,
    (inner: string) => `<w:sdt><w:sdtPr/><w:sdtContent>${inner}</w:sdtContent></w:sdt>`,
  ];
  for (const [format, inControl] of ['', '<w:rPr><w:b/></w:rPr>'].flatMap((format) =>
    controls.map((control) => [format, control] as const)
  )) {
    const tail = `<w:r>${format}<w:t>ef</w:t></w:r>`;
    const one = typed(
      `<w:r><w:t>ab</w:t></w:r>${inControl(insertion(`<w:r><w:t>cd</w:t></w:r>${tail}`))}`
    );
    const wrappers = typed(
      `<w:r><w:t>ab</w:t></w:r>${inControl(insertion('<w:r><w:t>cd</w:t></w:r>') + insertion(tail))}`
    );
    // The typed text takes the format of the run before it, inside the change.
    expect(one).toContain('<w:r><w:t>cdX</w:t></w:r>');
    expect(wrappers).toBe(one);
  }
});
