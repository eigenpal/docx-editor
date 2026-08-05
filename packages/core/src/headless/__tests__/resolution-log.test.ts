import { describe, expect, test } from 'bun:test';
import {
  acknowledgeResolutions,
  peekResolutions,
  recordResolution,
  type RecordedResolution,
} from '../resolution-log.ts';
import type { CanonicalRevisionRef } from '../revision-bridge.ts';

const bodyRef: CanonicalRevisionRef = {
  story: { kind: 'body' },
  type: 'insertion',
  address: { id: '1', author: 'A', date: '2026-01-01T00:00:00Z' },
  nodeId: 'ins-node',
};

function resolutionKey(resolution: RecordedResolution): string {
  const ref = resolution.ref;
  return `${resolution.mode}:${ref.story.kind}:${ref.type}:${ref.address.id}:${ref.address.author}:${ref.address.date ?? ''}`;
}

describe('headless resolution log', () => {
  test('peek does not drain; acknowledge removes only consumed entries', () => {
    const doc: object = {};
    recordResolution(doc, bodyRef, 'accept');
    expect(peekResolutions(doc)).toEqual([{ ref: bodyRef, mode: 'accept' }]);
    expect(peekResolutions(doc)).toEqual([{ ref: bodyRef, mode: 'accept' }]);
    acknowledgeResolutions(doc, [{ ref: bodyRef, mode: 'accept' }]);
    expect(peekResolutions(doc)).toEqual([]);
  });

  test('failed repack leaves resolution log intact for retry', async () => {
    const { parseDocx, repackDocx, HeadlessRepackRefusal } = await import('../parse.ts');
    const { strToU8, zipSync } = await import('fflate');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p>` +
          `<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>keep</w:t></w:r></w:ins>` +
          `</w:p><w:sectPr/></w:body></w:document>`
      ),
    });
    const doc = await parseDocx(bytes.buffer.slice(0));
    recordResolution(doc, bodyRef, 'accept');
    doc.package.document.content.push({
      type: 'table',
      rows: [{ cells: [{ content: [{ type: 'paragraph', content: [] }] }] }],
    });
    await expect(repackDocx(doc)).rejects.toBeInstanceOf(HeadlessRepackRefusal);
    expect(peekResolutions(doc)).toEqual([{ ref: bodyRef, mode: 'accept' }]);
  });

  test('move reject refusal then corrected accept persists on retry', async () => {
    const { parseDocx, repackDocx, HeadlessRepackRefusal } = await import('../parse.ts');
    const { headlessContextOf } = await import('../context.ts');
    const { readOoxmlPackage } = await import('../../store/package/ooxml-package.ts');
    const { serializeOoxmlPart } = await import('../../store/package/ooxml-tree.ts');
    const { strToU8, zipSync } = await import('fflate');
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
    const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>` +
          `<w:p><w:moveFromRangeStart w:id="10" w:name="m1" w:author="A" w:date="2026-01-01T00:00:00Z"/>` +
          `<w:moveFrom w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>here</w:delText></w:r></w:moveFrom>` +
          `<w:moveFromRangeEnd w:id="10"/></w:p>` +
          `<w:p><w:moveToRangeStart w:id="11" w:name="m1" w:author="A" w:date="2026-01-01T00:00:00Z"/>` +
          `<w:moveTo w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>here</w:t></w:r></w:moveTo>` +
          `<w:moveToRangeEnd w:id="11"/></w:p>` +
          `<w:sectPr/></w:body></w:document>`
      ),
    });
    const doc = await parseDocx(bytes.buffer.slice(0));
    const moveFrom = headlessContextOf(doc)?.revisionIndex.entries.find(
      (entry) => entry.ref.type === 'moveFrom'
    )?.ref;
    if (!moveFrom) throw new Error('expected moveFrom revision');
    recordResolution(doc, moveFrom, 'reject');
    doc.package.document.content.push({
      type: 'table',
      rows: [{ cells: [{ content: [{ type: 'paragraph', content: [] }] }] }],
    });
    await expect(repackDocx(doc)).rejects.toBeInstanceOf(HeadlessRepackRefusal);
    expect(peekResolutions(doc)).toEqual([{ ref: moveFrom, mode: 'reject' }]);

    doc.package.document.content.pop();
    recordResolution(doc, moveFrom, 'accept');
    const out = await repackDocx(doc);
    const loaded = readOoxmlPackage(new Uint8Array(out));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const xml = serializeOoxmlPart(loaded.package.parts.get('/word/document.xml')!);
    expect(xml.match(/here/g)?.length ?? 0).toBe(1);
    expect(xml).not.toContain('<w:moveFrom');
    expect(peekResolutions(doc)).toEqual([]);
  });
});
