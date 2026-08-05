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

const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const STYLES_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml';

/**
 * A package, optionally with a styles part.
 *
 * `styles` is the `w:style` elements themselves; a document given none has no styles part at all,
 * which is a state the style reads have to answer for rather than assume away.
 */
export function docx(body: string, styles?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
        (styles === undefined
          ? ''
          : `<Override PartName="/word/styles.xml" ContentType="${STYLES_CT}"/>`) +
        `</Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    ...(styles === undefined
      ? {}
      : {
          'word/_rels/document.xml.rels': strToU8(
            `<Relationships xmlns="${REL}"><Relationship Id="rId2" Type="${STYLES_REL}" Target="styles.xml"/></Relationships>`
          ),
          'word/styles.xml': strToU8(`<w:styles xmlns:w="${W}">${styles}</w:styles>`),
        }),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

/** A paragraph style definition, by id and gallery name. */
export const style = (styleId: string, name: string): string =>
  `<w:style w:type="paragraph" w:styleId="${styleId}"><w:name w:val="${name}"/></w:style>`;

export const p = (text: string): string => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/** The default fixture: two paragraphs, so a collection has more than one item. */
export const TWO_PARAGRAPHS = docx(`${p('alpha')}${p('beta')}`);
