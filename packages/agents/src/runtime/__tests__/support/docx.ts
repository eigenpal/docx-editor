// Minimal real DOCX bytes for the runtime tests.
//
// Real packages rather than a fake host, because the point of most of these tests is that the
// proxy lifecycle drives an actual document through the actual core host: a stubbed host would
// let the runtime's own bookkeeping agree with itself and prove nothing about the protocol.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

export const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** The default fixture: two paragraphs, so a collection has more than one item. */
export const TWO_PARAGRAPHS = docx(`${p('alpha')}${p('beta')}`);
