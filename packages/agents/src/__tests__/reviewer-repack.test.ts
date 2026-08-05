import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { DocxReviewer } from '../DocxReviewer.ts';
import { readOoxmlPackage } from '../../../core/src/store/package/ooxml-package.ts';
import {
  diffSemanticDigests,
  semanticDigest,
} from '../../../core/src/store/package/ooxml-digest.ts';
import { serializeOoxmlPart } from '../../../core/src/store/package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

const FN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes';

function minimalDocx(paragraphInner: string): ArrayBuffer {
  const body =
    `<w:document xmlns:w="${W}">` +
    `<w:body><w:p>${paragraphInner}</w:p><w:sectPr/></w:body></w:document>`;
  const bytes = zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(body),
  });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('DocxReviewer tracked repack', () => {
  test('replace → toBuffer preserves w:del/w:ins and reopens', async () => {
    const input = minimalDocx('<w:r><w:t>Hello world</w:t></w:r>');
    const reviewer = await DocxReviewer.fromBuffer(input, 'Agent');
    reviewer.replace(0, 'world', 'universe');
    const out = await reviewer.toBuffer();
    const loaded = readOoxmlPackage(new Uint8Array(out));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const xml = serializeOoxmlPart(loaded.package.parts.get('/word/document.xml')!);
    expect(xml).toContain('<w:del');
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('world');
    expect(xml).toContain('universe');
    const reopened = await DocxReviewer.fromBuffer(out, 'Agent');
    expect(reopened.getContentAsText()).toContain('world');
    expect(reopened.getContentAsText()).toContain('universe');
    expect(reopened.getChanges().length).toBeGreaterThan(0);
  });

  test('proposeReplacement via applyReview batch repacks', async () => {
    const input = minimalDocx('<w:r><w:t>Alpha beta</w:t></w:r>');
    const reviewer = await DocxReviewer.fromBuffer(input, 'Batch');
    const result = reviewer.applyReview({
      proposals: [{ paragraphIndex: 0, search: 'beta', replaceWith: 'gamma' }],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.proposalsAdded).toBe(1);
    const out = await reviewer.toBuffer();
    const loaded = readOoxmlPackage(new Uint8Array(out));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const xml = serializeOoxmlPart(loaded.package.parts.get('/word/document.xml')!);
    expect(xml).toContain('<w:del');
    expect(xml).toContain('<w:ins');
  });

  test('acceptChange after replace persists on repack', async () => {
    const input = minimalDocx('<w:r><w:t>Keep remove</w:t></w:r>');
    const reviewer = await DocxReviewer.fromBuffer(input, 'Agent');
    reviewer.replace(0, 'remove', 'saved');
    const changes = reviewer.getChanges();
    expect(changes.length).toBeGreaterThan(0);
    reviewer.acceptChange(changes[0]!);
    const out = await reviewer.toBuffer();
    const loaded = readOoxmlPackage(new Uint8Array(out));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const xml = serializeOoxmlPart(loaded.package.parts.get('/word/document.xml')!);
    expect(xml).toContain('saved');
    expect(xml).not.toMatch(/<w:t[^>]*>remove<\/w:t>/);
    expect(xml).not.toContain('<w:delText>remove</w:delText>');
  });

  test('no-op reopen returns exact bytes', async () => {
    const input = minimalDocx('<w:r><w:t>Exact</w:t></w:r>');
    const reviewer = await DocxReviewer.fromBuffer(input, 'Agent');
    const out = await reviewer.toBuffer();
    expect(new Uint8Array(out)).toEqual(new Uint8Array(input));
  });

  test('editable-sample comment add still preserves unrelated OOXML', async () => {
    const original = readFileSync(
      resolve(import.meta.dir, '../../../../e2e/fixtures/editable-sample.docx')
    );
    const reviewer = await DocxReviewer.fromBuffer(original.buffer.slice(0), 'Agent');
    reviewer.addComment(0, 'Looks good');
    const out = await reviewer.toBuffer();
    const before = readOoxmlPackage(new Uint8Array(original));
    const after = readOoxmlPackage(new Uint8Array(out));
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.package.parts.has('/word/comments.xml')).toBe(true);
    expect(
      diffSemanticDigests(
        semanticDigest(before.package.parts.values()),
        semanticDigest(after.package.parts.values())
      )
    ).not.toContain(expect.stringMatching(/^missing part/));
  });
});

describe('DocxReviewer revision blockers', () => {
  test('discovery keeps insertion and deletion with the same authored id separate', async () => {
    const input = minimalDocx(
      '<w:ins w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>new</w:t></w:r></w:ins>' +
        '<w:del w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:delText>old</w:delText></w:r></w:del>'
    );
    const reviewer = await DocxReviewer.fromBuffer(input, 'Agent');
    const changes = reviewer.getChanges();
    expect(changes.map((c) => c.type).sort()).toEqual(['deletion', 'insertion']);
    reviewer.rejectChange(changes.find((c) => c.type === 'insertion')!);
    const out = await reviewer.toBuffer();
    const loaded = readOoxmlPackage(new Uint8Array(out));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const xml = serializeOoxmlPart(loaded.package.parts.get('/word/document.xml')!);
    expect(xml).not.toContain('<w:ins');
    expect(xml).toContain('<w:del');
  });

  test('batch replacements in one paragraph repack and reopen with both revisions', async () => {
    const input = minimalDocx('<w:r><w:t>Alpha beta gamma</w:t></w:r>');
    const reviewer = await DocxReviewer.fromBuffer(input, 'Batch');
    const result = reviewer.applyReview({
      proposals: [
        { paragraphIndex: 0, search: 'Alpha', replaceWith: 'One' },
        { paragraphIndex: 0, search: 'gamma', replaceWith: 'Three' },
      ],
    });
    expect(result.errors).toHaveLength(0);
    expect(result.proposalsAdded).toBe(2);
    const out = await reviewer.toBuffer();
    const loaded = readOoxmlPackage(new Uint8Array(out));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const xml = serializeOoxmlPart(loaded.package.parts.get('/word/document.xml')!);
    expect(xml).toContain('One');
    expect(xml).toContain('Three');
    expect(xml).toContain('beta');
    const reopened = await DocxReviewer.fromBuffer(out, 'Batch');
    expect(reopened.getChanges().length).toBeGreaterThanOrEqual(2);
  });

  test('acceptChange in a footnote persists on toBuffer reopen', async () => {
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
          `<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`
      ),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${FN}" Target="footnotes.xml"/></Relationships>`
      ),
      'word/footnotes.xml': strToU8(
        `<w:footnotes xmlns:w="${W}"><w:footnote w:id="1"><w:p><w:ins w:id="5" w:author="A" w:date="2026-01-01T00:00:00Z"><w:r><w:t>note</w:t></w:r></w:ins></w:p></w:footnote></w:footnotes>`
      ),
    });
    const input = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const reviewer = await DocxReviewer.fromBuffer(input, 'Agent');
    const change = reviewer.getChanges({ includeFootnotes: true })[0]!;
    reviewer.acceptChange(change);
    const out = await reviewer.toBuffer();
    const fnLoaded = readOoxmlPackage(new Uint8Array(out));
    expect(fnLoaded.ok).toBe(true);
    if (!fnLoaded.ok) return;
    const fnXml = serializeOoxmlPart(fnLoaded.package.parts.get('/word/footnotes.xml')!);
    expect(fnXml).toContain('note');
    expect(fnXml).not.toContain('<w:ins');
  });

  test('acceptChange on a move persists through toBuffer reopen', async () => {
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
    const moveInput = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const reviewer = await DocxReviewer.fromBuffer(moveInput, 'Agent');
    const moveFrom = reviewer.getChanges().find((c) => c.type === 'moveFrom')!;
    reviewer.acceptChange(moveFrom);
    const out = await reviewer.toBuffer();
    const moveLoaded = readOoxmlPackage(new Uint8Array(out));
    expect(moveLoaded.ok).toBe(true);
    if (!moveLoaded.ok) return;
    const xml = serializeOoxmlPart(moveLoaded.package.parts.get('/word/document.xml')!);
    expect(xml.match(/here/g)?.length ?? 0).toBe(1);
    expect(xml).not.toContain('<w:moveFrom');
    expect(xml).not.toContain('<w:moveTo');
    expect(xml).not.toContain('moveFromRangeStart');
  });
});
