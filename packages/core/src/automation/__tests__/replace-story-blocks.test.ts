import { describe, expect, test } from 'bun:test';
import { docx, open, p, pWithSection, roots, savedMainXml, sdt } from './support/protocol.ts';

describe('replaceStoryBlocks', () => {
  test('atomically replaces wrappers and section-ending paragraphs with plain paragraphs', () => {
    const host = open(
      docx(
        sdt(p('inside control')) +
          pWithSection('old section') +
          p('tail') +
          '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>'
      )
    );
    const { body } = roots(host);
    const response = host.execute({
      operations: [
        {
          op: 'replaceStoryBlocks',
          body,
          paragraphs: ['Fresh title', 'First paragraph', ''],
        },
      ],
    });
    expect(response).toMatchObject({
      ok: true,
      changed: true,
      results: [{ status: 'ok', value: { kind: 'applied' } }],
    });
    const xml = savedMainXml(host);
    expect(xml).not.toContain('<w:sdt');
    expect(xml).not.toContain('old section');
    expect(xml).toContain('Fresh title');
    expect(xml.match(/<w:sectPr/g)).toHaveLength(1);
    expect(xml.match(/w14:paraId="[0-9A-F]{8}"/g)).toHaveLength(3);
    expect(xml).toContain('w:w="12240"');
  });
});
