// The bytes a "New document" gesture loads — Word's own blank template, not a bare shell.
//
// A minimal document.xml with no styles part falls to the FORMAT's defaults (10pt, no
// font authored anywhere), which is not what a user who pressed New expects: Word's
// blank template authors its defaults explicitly — Calibri at 11pt with the Normal
// style's paragraph spacing — in `w:docDefaults`. This template does the same, so the
// engine measures, paints and reports exactly what the toolbar shows, and the saved
// file opens in Word looking identical.
//
// The font family is authored DIRECTLY (`w:ascii="Calibri"`), not as a theme reference:
// no theme part ships here, and layout's theme-font resolution is a separate lane. The
// name is the Word name; rendering resolves through the host's font configuration
// (metric substitutes or real bytes) like any other document.

import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OFFICE_DOCUMENT =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLES_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="${CT}">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="${REL}">` +
  `<Relationship Id="rId1" Type="${OFFICE_DOCUMENT}" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="${REL}">` +
  `<Relationship Id="rId1" Type="${STYLES_REL}" Target="styles.xml"/>` +
  `</Relationships>`;

// Word's blank-template defaults: Calibri 11pt run defaults, and the Normal paragraph
// rhythm (8pt space after, 1.08-line spacing) in the paragraph defaults — the values
// Word writes, so a save/reopen in Word shows the same text metrics.
const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="${W}">` +
  `<w:docDefaults>` +
  `<w:rPrDefault><w:rPr>` +
  `<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>` +
  `<w:sz w:val="22"/><w:szCs w:val="22"/>` +
  `</w:rPr></w:rPrDefault>` +
  `<w:pPrDefault><w:pPr>` +
  `<w:spacing w:after="160" w:line="259" w:lineRule="auto"/>` +
  `</w:pPr></w:pPrDefault>` +
  `</w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal">` +
  `<w:name w:val="Normal"/><w:qFormat/>` +
  `</w:style>` +
  `</w:styles>`;

// US Letter with one-inch margins — the geometry Word's own blank template carries.
const DOCUMENT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:document xmlns:w="${W}">` +
  `<w:body>` +
  `<w:p/>` +
  `<w:sectPr>` +
  `<w:pgSz w:w="12240" w:h="15840"/>` +
  `<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>` +
  `</w:sectPr>` +
  `</w:body>` +
  `</w:document>`;

/**
 * A Word-faithful blank document, freshly zipped per call (the caller may hand the
 * bytes to a loader that takes ownership). Calibri 11pt and Word's Normal paragraph
 * spacing are authored in `w:docDefaults`, US Letter geometry in the section — a New
 * document behaves like Word's, and saving it produces a file Word opens identically.
 *
 * @public
 */
export function blankDocumentBytes(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/_rels/document.xml.rels': strToU8(DOCUMENT_RELS),
    'word/document.xml': strToU8(DOCUMENT),
    'word/styles.xml': strToU8(STYLES),
  });
}
