import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { parseDocx } from '@docx-editor.dev/core/headless';
import { peekResolutions } from '@docx-editor.dev/core/headless';
import { acceptChange } from '../changes.ts';
import type { Document, DocumentBody } from '@docx-editor.dev/core/headless';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function minimalTrackedDocx(): ArrayBuffer {
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
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('accept/reject resolution transaction', () => {
  test('failed acceptChange does not record resolution', async () => {
    const doc = await parseDocx(minimalTrackedDocx());
    const body = doc.package.document as DocumentBody;
    expect(() => acceptChange(doc as Document, body, 999)).toThrow();
    expect(peekResolutions(doc)).toEqual([]);
  });

  test('successful acceptChange records resolution exactly once', async () => {
    const doc = await parseDocx(minimalTrackedDocx());
    const body = doc.package.document as DocumentBody;
    acceptChange(doc as Document, body, 1);
    const pending = peekResolutions(doc);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.mode).toBe('accept');
    expect(pending[0]?.ref.address.id).toBe('1');
  });

  test('repeated failed accept after prior success does not undo logged resolution', async () => {
    const doc = await parseDocx(minimalTrackedDocx());
    const body = doc.package.document as DocumentBody;
    acceptChange(doc as Document, body, 1);
    expect(peekResolutions(doc)).toHaveLength(1);
    expect(() => acceptChange(doc as Document, body, 999)).toThrow();
    expect(peekResolutions(doc)).toHaveLength(1);
  });
});
