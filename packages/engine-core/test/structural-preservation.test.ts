// Structural editing under selective preservation (queue item 6 foundation): a paragraph
// split / join / insert / delete regenerates the block region from the model while the
// trailing w:sectPr, the shell, and every other part (styles.xml) stay verbatim. Fails
// closed when the body is not all fully-captured paragraphs (a table can't be regenerated).

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { parseDocx, writeDocx, DocumentStore, bodyStoryId, ORIGIN_IDS } from '../src/index.ts';
import type { ParagraphRecord } from '../src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function docx(bodyInner: string, extra: Record<string, string> = {}): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(`<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`),
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, strToU8(v)])),
  });
}
const SECT = '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>';
const STYLES = { 'word/styles.xml': `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="A"><w:name w:val="A"/></w:style></w:styles>` };

function openPreserved(bytes: Uint8Array) {
  const r = parseDocx(bytes, { preserveAll: true });
  if (!r.ok) throw new Error(`parse failed: ${r.reason} ${r.detail ?? ''}`);
  return new DocumentStore(r.model);
}
const bodyParas = (store: DocumentStore) =>
  store.currentModel.stories
    .get(bodyStoryId(store.currentModel))!
    .blocks.filter((b): b is ParagraphRecord => b.kind === 'paragraph');
const savedDocXml = (store: DocumentStore) => strFromU8(unzipSync(writeDocx(store.currentModel))['word/document.xml']);

describe('structural editing regenerates the block region, keeps sectPr + parts verbatim', () => {
  test('splitParagraph: one paragraph becomes two; sectPr and styles.xml survive', () => {
    const store = openPreserved(docx('<w:p><w:r><w:t>helloworld</w:t></w:r></w:p>' + SECT, STYLES));
    const id = bodyParas(store)[0].id;
    store.transact(ORIGIN_IDS.mutationHuman, (c) => c.apply({ op: 'splitParagraph', paragraphId: id, offset: 5 }));
    expect(bodyParas(store)).toHaveLength(2);

    const xml = savedDocXml(store);
    expect(xml).toContain('<w:sectPr>'); // trailing section properties preserved
    expect((xml.match(/<w:p>/g) ?? []).length).toBe(2); // two paragraphs now
    expect(unzipSync(writeDocx(store.currentModel))['word/styles.xml']).toBeDefined();

    const re = parseDocx(writeDocx(store.currentModel));
    if (!re.ok) throw new Error('reopen failed');
    const reParas = re.model.stories.get(bodyStoryId(re.model))!.blocks;
    expect(reParas.map((b) => b.kind)).toEqual(['paragraph', 'paragraph']);
    expect((reParas[0] as ParagraphRecord).runs.map((r) => r.text).join('')).toBe('hello');
    expect((reParas[1] as ParagraphRecord).runs.map((r) => r.text).join('')).toBe('world');
  });

  test('appendParagraph (ordered insertion at end): the new paragraph is saved, sectPr kept', () => {
    const store = openPreserved(docx('<w:p><w:r><w:t>one</w:t></w:r></w:p>' + SECT));
    store.applyEdits(
      [
        { op: 'appendParagraph', storyId: bodyStoryId(store.currentModel), symbolicId: '$new' },
        { op: 'setParagraphRuns', paragraphId: '$new', runs: [{ text: 'two' }] },
      ],
      ORIGIN_IDS.mutationHuman,
    );
    expect(bodyParas(store)).toHaveLength(2);
    const xml = savedDocXml(store);
    expect(xml).toContain('two');
    expect(xml).toContain('<w:sectPr>');
  });

  test('deleteParagraph: removed paragraph is gone on save; sectPr kept', () => {
    const store = openPreserved(docx('<w:p><w:r><w:t>keep</w:t></w:r></w:p><w:p><w:r><w:t>drop</w:t></w:r></w:p>' + SECT));
    const dropId = bodyParas(store)[1].id;
    store.transact(ORIGIN_IDS.mutationHuman, (c) => c.apply({ op: 'deleteParagraph', paragraphId: dropId }));
    const xml = savedDocXml(store);
    expect(xml).toContain('keep');
    expect(xml).not.toContain('drop');
    expect(xml).toContain('<w:sectPr>');
  });

  test('a structural edit fails closed when the body has a non-regenerable block (table)', () => {
    const store = openPreserved(
      docx('<w:p><w:r><w:t>a</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>c</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'),
    );
    // Delete the paragraph -> structural change; the remaining table cannot be regenerated.
    const pId = store.currentModel.stories.get(bodyStoryId(store.currentModel))!.blocks.find((b) => b.kind === 'paragraph')!.id;
    store.transact(ORIGIN_IDS.mutationHuman, (c) => c.apply({ op: 'deleteParagraph', paragraphId: pId }));
    expect(() => writeDocx(store.currentModel)).toThrow(/fail closed/);
  });
});
