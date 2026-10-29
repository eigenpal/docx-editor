import { expect, test } from 'bun:test';
import { applyTreeOp, readOoxmlPart, serializeOoxmlPart, type OoxmlNode } from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function load(body: string) {
  const read = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'application/xml' }
  );
  if (!read.ok) throw Error(read.reason);
  return read.part;
}

function paragraphs(root: OoxmlNode): OoxmlNode[] {
  if (root.kind === 'textValue') return [];
  if (root.kind === 'paragraph') return [root];
  return root.children.flatMap(paragraphs);
}

// Removing a paragraph's mark joins it into the paragraph after it. The joined paragraph is
// the first one, as a join by deleting the mark is, with the properties of the mark that
// remains: the undo of the split that inserted the mark removes the second paragraph, so
// a decision and that undo keep the same paragraph.
for (const { action, kind } of [
  { action: 'rejectAllRevisions', kind: 'ins' },
  { action: 'acceptAllRevisions', kind: 'del' },
] as const) {
  test(`${action} on a ${kind} mark keeps the first paragraph and the last mark's properties`, () => {
    const part = load(
      `<w:p w14:paraId="00000001"><w:pPr><w:jc w:val="left"/><w:rPr>` +
        `<w:${kind} w:id="1" w:author="Ada"/></w:rPr></w:pPr><w:r><w:t xml:space="preserve">One; </w:t></w:r></w:p>` +
        `<w:p w14:paraId="00000002"><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>two</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Signed</w:t></w:r></w:p>`
    );
    const [first] = paragraphs(part.root);
    const result = applyTreeOp(part, { op: action });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = paragraphs(result.part.root);
    expect(after).toHaveLength(2);
    expect(after[0]!.id).toBe(first!.id);
    const xml = serializeOoxmlPart(result.part);
    expect(xml).toContain(
      '<w:p w14:paraId="00000001"><w:pPr><w:jc w:val="right"/></w:pPr>' +
        '<w:r><w:t xml:space="preserve">One; </w:t></w:r><w:r><w:t>two</w:t></w:r></w:p>'
    );
    expect(xml).not.toContain('00000002');
  });
}
