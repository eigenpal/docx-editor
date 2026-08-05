// Preservation-first headless parse/repack (re-review blocker 1).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import {
  parseDocx,
  repackDocx,
  HeadlessRepackRefusal,
  cloneDocumentPreservingContext,
} from '../index.ts';
import { readOoxmlPackage, type OoxmlPackage } from '../../store/package/ooxml-package.ts';
import { canonicalOoxmlFingerprint, serializeOoxmlPart } from '../../store/package/ooxml-tree.ts';
import { diffSemanticDigests, semanticDigest } from '../../store/package/ooxml-digest.ts';
import { projectDrawingsInPackage } from '../../store/package/drawing-projection.ts';

const FIXTURES = resolve(import.meta.dir, '../../../../../e2e/fixtures');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function openPackage(bytes: ArrayBuffer): OoxmlPackage {
  const loaded = readOoxmlPackage(new Uint8Array(bytes));
  if (!loaded.ok) throw new Error(loaded.reason);
  return loaded.package;
}

function digestOf(pkg: OoxmlPackage) {
  return semanticDigest(pkg.parts.values());
}

function drawingCount(pkg: OoxmlPackage): number {
  return projectDrawingsInPackage(pkg).length;
}

describe('headless preservation-first repack', () => {
  test('no-op images-crop returns exact original bytes', async () => {
    const original = readFileSync(resolve(FIXTURES, 'images-crop.docx'));
    const doc = await parseDocx(original.buffer.slice(0));
    const out = await repackDocx(doc);
    expect(new Uint8Array(out)).toEqual(new Uint8Array(original));
  });

  test('no-op comprehensive fixture passes D9 digest', async () => {
    const original = readFileSync(resolve(FIXTURES, 'comprehensive-word-element-test.docx'));
    const doc = await parseDocx(original.buffer.slice(0));
    const out = await repackDocx(doc);
    const before = openPackage(original.buffer.slice(0));
    const after = openPackage(out);
    expect(diffSemanticDigests(digestOf(before), digestOf(after))).toEqual([]);
    expect(drawingCount(before)).toBe(drawingCount(after));
  });

  test('text edit preserves surrounding inline drawing', async () => {
    const body =
      `<w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}" xmlns:r="${R}">` +
      `<w:body><w:p><w:r><w:t>before</w:t></w:r>` +
      `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
      '<wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="pic"/>' +
      `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="${PIC}"><pic:nvPicPr><pic:cNvPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>' +
      `<w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
    const bytes = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          '<Default Extension="png" ContentType="image/png"/>' +
          `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(body),
      'word/_rels/document.xml.rels': strToU8(
        `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${R}/image" Target="media/image1.png"/></Relationships>`
      ),
      'word/media/image1.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]),
    });
    const doc = await parseDocx(bytes.buffer.slice(0));
    const beforeDrawings = drawingCount(openPackage(bytes.buffer.slice(0)));
    const para = doc.package.document.content[0];
    if (para?.type === 'paragraph') {
      const firstRun = para.content.find((c) => c.type === 'run');
      if (firstRun?.type === 'run' && firstRun.content[0]?.type === 'text') {
        firstRun.content[0].text = 'before!';
      }
    }
    const out = await repackDocx(doc);
    const afterPkg = openPackage(out);
    expect(drawingCount(afterPkg)).toBe(beforeDrawings);
    expect(canonicalOoxmlFingerprint(afterPkg.parts.get('/word/document.xml')!)).toContain(
      'drawing'
    );
  });

  test('unsupported table row insertion refuses explicitly', async () => {
    const doc = await parseDocx(
      readFileSync(resolve(FIXTURES, 'editable-sample.docx')).buffer.slice(0)
    );
    doc.package.document.content.push({
      type: 'table',
      rows: [{ cells: [{ content: [{ type: 'paragraph', content: [] }] }] }],
    });
    await expect(repackDocx(doc)).rejects.toBeInstanceOf(HeadlessRepackRefusal);
  });

  test('cloneDocumentPreservingContext retains repack ability', async () => {
    const original = readFileSync(resolve(FIXTURES, 'images-crop.docx'));
    const doc = await parseDocx(original.buffer.slice(0));
    const cloned = cloneDocumentPreservingContext(doc);
    const out = await repackDocx(cloned);
    expect(new Uint8Array(out)).toEqual(new Uint8Array(original));
  });

  test('comment add repacks when anchored on a paragraph', async () => {
    const original = readFileSync(resolve(FIXTURES, 'editable-sample.docx'));
    const doc = await parseDocx(original.buffer.slice(0));
    const para = doc.package.document.content[0];
    if (para?.type !== 'paragraph') throw new Error('expected paragraph');
    para.content.unshift({ type: 'commentRangeStart', id: 1 });
    para.content.push({ type: 'commentRangeEnd', id: 1 });
    doc.package.document.comments = [
      {
        id: 1,
        author: 'Test',
        date: new Date().toISOString(),
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'run', content: [{ type: 'text', text: 'note' }] }],
          },
        ],
      },
    ];
    const out = await repackDocx(doc);
    const reopened = openPackage(out);
    expect(reopened.parts.has('/word/comments.xml')).toBe(true);
  });

  test('tracked replacement repacks with canonical w:del/w:ins semantics', async () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
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
          `<w:r><w:t>Sample</w:t></w:r><w:r><w:t> body</w:t></w:r>` +
          `</w:p><w:sectPr/></w:body></w:document>`
      ),
    });
    const original = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const doc = await parseDocx(original);
    const para = doc.package.document.content[0];
    if (para?.type !== 'paragraph') throw new Error('expected paragraph');
    para.content = [
      {
        type: 'deletion',
        info: { id: 1, author: 'Test', date: '2026-01-02T03:04:05Z' },
        content: [{ type: 'run', content: [{ type: 'text', text: 'Sample' }] }],
      },
      {
        type: 'insertion',
        info: { id: 2, author: 'Test', date: '2026-01-02T03:04:05Z' },
        content: [{ type: 'run', content: [{ type: 'text', text: 'Changed' }] }],
      },
      { type: 'run', content: [{ type: 'text', text: ' body' }] },
    ];
    const out = await repackDocx(doc);
    const reopened = openPackage(out);
    const xml = serializeOoxmlPart(reopened.parts.get('/word/document.xml')!);
    expect(xml).toContain('<w:del');
    expect(xml).toContain('<w:ins');
    expect(xml).toContain('Sample');
    expect(xml).toContain('Changed');
    const before = openPackage(original);
    expect(diffSemanticDigests(digestOf(before), digestOf(reopened)).length).toBeGreaterThan(0);
  });
});
