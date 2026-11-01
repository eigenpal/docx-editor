/**
 * Minimal, deterministic DOCX writer for the synthetic compare corpus.
 * Every value is synthetic; nothing comes from a customer document.
 */
import { strToU8, zipSync, zlibSync } from 'fflate';

export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WML_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

export interface CommentSpec {
  readonly id: number;
  readonly author: string;
  readonly text: string;
}

export interface MediaSpec {
  /** File name under word/media/. */
  readonly name: string;
  readonly bytes: Uint8Array;
  /** Relationship id referenced from the body XML. */
  readonly rId: string;
}

export interface DocSpec {
  /** Body XML without the final w:sectPr. */
  readonly body: string;
  /** Final section properties XML (w:sectPr element); default Letter, 1-inch margins. */
  readonly sectPr?: string;
  readonly headers?: Readonly<Record<'default' | 'first' | 'even', string | undefined>>;
  readonly footers?: Readonly<Record<'default' | 'first' | 'even', string | undefined>>;
  /** Footnote bodies keyed by id (ids start at 1). Body XML is paragraph content. */
  readonly footnotes?: Readonly<Record<number, string>>;
  readonly endnotes?: Readonly<Record<number, string>>;
  readonly comments?: readonly CommentSpec[];
  readonly media?: readonly MediaSpec[];
  /** Extra hyperlink relationships: rId -> external URL. */
  readonly hyperlinks?: Readonly<Record<string, string>>;
  /** Extra w:style elements appended to styles.xml. */
  readonly extraStyles?: string;
  /** Replaces the default numbering definitions. */
  readonly numbering?: string;
  /** Extra w:settings children (for example w:evenAndOddHeaders). */
  readonly settings?: string;
  /** dc:creator and cp:lastModifiedBy. */
  readonly author?: string;
}

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const DEFAULT_SECT_PR =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
  '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>' +
  '<w:cols w:space="720"/></w:sectPr>';

const STYLES = (extra: string) =>
  `<w:styles xmlns:w="${W_NS}">` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
  '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>' +
  '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
  '<w:style w:type="numbering" w:default="1" w:styleId="NoList"><w:name w:val="No List"/><w:semiHidden/></w:style>' +
  [1, 2, 3]
    .map(
      (level) =>
        `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
        `<w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="${480 - level * 80}" w:after="80"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
        `<w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="${36 - level * 4}"/></w:rPr></w:style>`
    )
    .join('') +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:sz w:val="48"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="864" w:right="864"/><w:jc w:val="center"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:basedOn w:val="DefaultParagraphFont"/><w:qFormat/><w:rPr><w:b/><w:bCs/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:basedOn w:val="DefaultParagraphFont"/><w:qFormat/><w:rPr><w:i/><w:iCs/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="EndnoteText"><w:name w:val="endnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="EndnoteReference"><w:name w:val="endnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:pPr><w:tabs><w:tab w:val="center" w:pos="4680"/><w:tab w:val="right" w:pos="9360"/></w:tabs><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:style>' +
  '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:tblPr><w:tblBorders>' +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((edge) => `<w:${edge} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`)
    .join('') +
  '</w:tblBorders></w:tblPr></w:style>' +
  extra +
  '</w:styles>';

/** numId 1 = bullets, numId 2 = decimal, numId 3 = decimal (second instance), numId 4 = lower letter. */
export const DEFAULT_NUMBERING =
  `<w:numbering xmlns:w="${W_NS}">` +
  abstractNum(0, (level) => ({ fmt: 'bullet', text: ['•', 'o', '▪'][level % 3]! })) +
  abstractNum(1, (level) => ({
    fmt: ['decimal', 'lowerLetter', 'lowerRoman'][level % 3]!,
    text: `%${level + 1}.`,
  })) +
  abstractNum(2, (level) => ({ fmt: 'lowerLetter', text: `(%${level + 1})` })) +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>' +
  '<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>' +
  '</w:numbering>';

function abstractNum(id: number, level: (n: number) => { fmt: string; text: string }): string {
  let xml = `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="hybridMultilevel"/>`;
  for (let n = 0; n < 9; n++) {
    const { fmt, text } = level(n);
    xml +=
      `<w:lvl w:ilvl="${n}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${esc(text)}"/>` +
      `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 * (n + 1)}" w:hanging="360"/></w:pPr>` +
      (fmt === 'bullet'
        ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>'
        : '') +
      '</w:lvl>';
  }
  return `${xml}</w:abstractNum>`;
}

const NS_DECL = `xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}"`;

function noteSeparators(kind: 'footnote' | 'endnote'): string {
  return (
    `<w:${kind} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:${kind}>` +
    `<w:${kind} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:${kind}>`
  );
}

function notesPart(kind: 'footnote' | 'endnote', notes: Readonly<Record<number, string>>): string {
  const style = kind === 'footnote' ? 'FootnoteText' : 'EndnoteText';
  const refStyle = kind === 'footnote' ? 'FootnoteReference' : 'EndnoteReference';
  const body = Object.entries(notes)
    .map(
      ([id, text]) =>
        `<w:${kind} w:id="${id}"><w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>` +
        `<w:r><w:rPr><w:rStyle w:val="${refStyle}"/></w:rPr><w:${kind}Ref/></w:r>` +
        `<w:r><w:t xml:space="preserve"> ${esc(text)}</w:t></w:r></w:p></w:${kind}>`
    )
    .join('');
  return `<w:${kind}s ${NS_DECL}>${noteSeparators(kind)}${body}</w:${kind}s>`;
}

/** Builds the DOCX bytes. The output is byte-identical for an identical spec. */
export function buildDocx(spec: DocSpec): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const overrides: string[] = [];
  const rels: string[] = [];
  let relCounter = 100;
  const addRel = (type: string, target: string, external = false, id?: string) => {
    const rid = id ?? `rId${relCounter++}`;
    rels.push(
      `<Relationship Id="${rid}" Type="${REL_TYPE}/${type}" Target="${esc(target)}"${external ? ' TargetMode="External"' : ''}/>`
    );
    return rid;
  };
  const addPart = (path: string, xml: string, contentType: string) => {
    files[path] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`);
    overrides.push(`<Override PartName="/${path}" ContentType="${contentType}"/>`);
  };

  addPart('word/styles.xml', STYLES(spec.extraStyles ?? ''), `${WML_CT}.styles+xml`);
  addRel('styles', 'styles.xml');
  addPart('word/numbering.xml', spec.numbering ?? DEFAULT_NUMBERING, `${WML_CT}.numbering+xml`);
  addRel('numbering', 'numbering.xml');
  addPart(
    'word/settings.xml',
    `<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/>${spec.settings ?? ''}<w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`,
    `${WML_CT}.settings+xml`
  );
  addRel('settings', 'settings.xml');

  let sectPr = spec.sectPr ?? DEFAULT_SECT_PR;
  const furniture: string[] = [];
  for (const kind of ['header', 'footer'] as const) {
    const map = kind === 'header' ? spec.headers : spec.footers;
    if (!map) continue;
    let n = 1;
    for (const variant of ['default', 'first', 'even'] as const) {
      const xml = map[variant];
      if (xml === undefined) continue;
      const name = `${kind}${n++}.xml`;
      const tag = kind === 'header' ? 'hdr' : 'ftr';
      addPart(`word/${name}`, `<w:${tag} ${NS_DECL}>${xml}</w:${tag}>`, `${WML_CT}.${kind}+xml`);
      // Images in a header or footer are relationships of that part.
      const own = (spec.media ?? []).filter((media) => xml.includes(`"${media.rId}"`));
      if (own.length > 0) {
        files[`word/_rels/${name}.rels`] = strToU8(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
            own
              .map(
                (media) =>
                  `<Relationship Id="${media.rId}" Type="${REL_TYPE}/image" Target="media/${esc(media.name)}"/>`
              )
              .join('') +
            '</Relationships>'
        );
      }
      const rid = addRel(kind, name);
      furniture.push(`<w:${kind}Reference w:type="${variant}" r:id="${rid}"/>`);
    }
  }
  if (furniture.length > 0) {
    // Header/footer references must come first inside w:sectPr.
    const ordered = [
      ...furniture.filter((ref) => ref.startsWith('<w:header')),
      ...furniture.filter((ref) => ref.startsWith('<w:footer')),
    ];
    sectPr = sectPr.replace('<w:sectPr>', `<w:sectPr>${ordered.join('')}`);
    const hasFirst = spec.headers?.first !== undefined || spec.footers?.first !== undefined;
    if (hasFirst && !sectPr.includes('<w:titlePg')) {
      sectPr = sectPr.replace('</w:sectPr>', '<w:titlePg/></w:sectPr>');
    }
  }
  if (spec.footnotes) {
    addPart('word/footnotes.xml', notesPart('footnote', spec.footnotes), `${WML_CT}.footnotes+xml`);
    addRel('footnotes', 'footnotes.xml');
  }
  if (spec.endnotes) {
    addPart('word/endnotes.xml', notesPart('endnote', spec.endnotes), `${WML_CT}.endnotes+xml`);
    addRel('endnotes', 'endnotes.xml');
  }
  if (spec.comments && spec.comments.length > 0) {
    const body = spec.comments
      .map(
        (comment) =>
          `<w:comment w:id="${comment.id}" w:author="${esc(comment.author)}" w:date="2026-01-05T10:00:00Z" w:initials="${esc(comment.author.slice(0, 2))}">` +
          `<w:p><w:r><w:annotationRef/></w:r><w:r><w:t xml:space="preserve">${esc(comment.text)}</w:t></w:r></w:p></w:comment>`
      )
      .join('');
    addPart(
      'word/comments.xml',
      `<w:comments ${NS_DECL}>${body}</w:comments>`,
      `${WML_CT}.comments+xml`
    );
    addRel('comments', 'comments.xml');
  }
  for (const media of spec.media ?? []) {
    files[`word/media/${media.name}`] = media.bytes;
    if (spec.body.includes(`"${media.rId}"`))
      addRel('image', `media/${media.name}`, false, media.rId);
  }
  for (const [rid, url] of Object.entries(spec.hyperlinks ?? {})) {
    addRel('hyperlink', url, true, rid);
  }

  addPart(
    'word/document.xml',
    `<w:document ${NS_DECL}><w:body>${spec.body}${sectPr}</w:body></w:document>`,
    `${WML_CT}.document.main+xml`
  );
  const author = esc(spec.author ?? 'Corpus Author');
  addPart(
    'docProps/core.xml',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      `<dc:creator>${author}</dc:creator><cp:lastModifiedBy>${author}</cp:lastModifiedBy>` +
      '<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2026-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>',
    'application/vnd.openxmlformats-package.core-properties+xml'
  );

  files['word/_rels/document.xml.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">${rels.join('')}</Relationships>`
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="word/document.xml"/>` +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>'
  );
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="${CT_NS}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Default Extension="png" ContentType="image/png"/>' +
      `${overrides.join('')}</Types>`
  );
  // Fixed timestamps keep the archive byte-stable across runs.
  const stamped: Record<string, [Uint8Array, { mtime: Date }]> = {};
  // Zip times are local fields: a local date gives the same bytes in every time zone.
  const fixed = new Date(2026, 0, 1);
  for (const name of Object.keys(files).sort()) stamped[name] = [files[name]!, { mtime: fixed }];
  return zipSync(stamped, { level: 6 });
}

// ---------------------------------------------------------------- PNG

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(strToU8(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A solid-color RGB PNG of the given size. */
export function solidPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number]
): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 2, 0, 0, 0], 8);
  const raw = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    for (let x = 0; x < width; x++) raw.set(rgb, row + 1 + x * 3);
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlibSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
