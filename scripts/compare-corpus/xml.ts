/** WordprocessingML snippets and a seeded text generator for the compare corpus. */
import { esc } from './docx-builder.ts';

// ---------------------------------------------------------------- PRNG and text

export type Rng = () => number;

/** mulberry32: small, fast, deterministic. */
export function rngOf(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Rng, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)]!;
export const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

const VOCAB = (
  'agreement party parties shall within days notice written terms conditions service services provider ' +
  'customer payment invoice period term renewal termination breach cure remedy liability damages indirect ' +
  'confidential information disclose recipient purpose obligation obligations survive effective date ' +
  'schedule exhibit section clause amendment waiver assignment consent reasonable delay governing law ' +
  'jurisdiction dispute resolution arbitration venue court fees costs expenses taxes applicable records ' +
  'audit access security data processing personal controller processor subprocessor incident report ' +
  'warranty warranties disclaimer fitness merchantability title infringement claim indemnify defend hold ' +
  'harmless insurance coverage policy limit aggregate annual monthly quarterly deliverable acceptance ' +
  'milestone project plan change order request approval price adjustment discount credit refund ' +
  'equipment property premises maintenance repair replacement inspection compliance regulation standard ' +
  'employee contractor personnel training safety environment quality performance level response time ' +
  'support hours business holiday force majeure event control failure suspension restore continue ' +
  'notice address delivery courier email receipt copy original counterpart signature authority binding ' +
  'entire understanding supersede prior oral statement representation severability invalid enforceable ' +
  'the a an of to and or in on for with by from as at under upon such any all each other this that'
).split(/\s+/);

export function words(rng: Rng, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(pick(rng, VOCAB));
  return out;
}

export function sentence(rng: Rng, min = 8, max = 18): string {
  const list = words(rng, int(rng, min, max));
  list[0] = list[0]!.charAt(0).toUpperCase() + list[0]!.slice(1);
  return `${list.join(' ')}.`;
}

export function paragraphText(rng: Rng, sentences = int(rng, 2, 4)): string {
  const out: string[] = [];
  for (let i = 0; i < sentences; i++) out.push(sentence(rng));
  return out.join(' ');
}

export function heading(rng: Rng): string {
  const list = words(rng, int(rng, 2, 4)).map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return list.join(' ');
}

// ---------------------------------------------------------------- WordprocessingML

/** One run. Tabs in `text` become w:tab, newlines become w:br. */
export function r(text: string, rPr = ''): string {
  const pieces = text.split(/(\t|\n)/);
  let inner = '';
  for (const piece of pieces) {
    if (piece === '') continue;
    if (piece === '\t') inner += '<w:tab/>';
    else if (piece === '\n') inner += '<w:br/>';
    else inner += `<w:t xml:space="preserve">${esc(piece)}</w:t>`;
  }
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}${inner}</w:r>`;
}

/** Deleted-text run (only inside w:del). */
export function rDel(text: string, rPr = ''): string {
  return `<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:delText xml:space="preserve">${esc(text)}</w:delText></w:r>`;
}

/** A paragraph from raw run content. */
export function pRaw(content: string, pPr = ''): string {
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${content}</w:p>`;
}

/** A paragraph with one plain run. */
export function p(text: string, pPr = '', rPr = ''): string {
  return pRaw(text === '' ? '' : r(text, rPr), pPr);
}

export const style = (id: string) => `<w:pStyle w:val="${id}"/>`;
export const listPr = (numId: number, ilvl = 0) =>
  `${style('ListParagraph')}<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`;

export interface CellSpec {
  readonly text: string;
  readonly tcPr?: string;
  /** Raw cell content instead of `text`. */
  readonly raw?: string;
}

export function table(
  rows: ReadonlyArray<ReadonlyArray<string | CellSpec>>,
  options: { widths?: readonly number[]; tblPr?: string; trPr?: (row: number) => string } = {}
): string {
  const columns = Math.max(...rows.map((row) => row.length));
  const widths =
    options.widths ?? Array.from({ length: columns }, () => Math.floor(9360 / columns));
  const total = widths.reduce((a, b) => a + b, 0);
  let xml =
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${total}" w:type="dxa"/>${options.tblPr ?? ''}` +
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>' +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  rows.forEach((row, index) => {
    const trPr = options.trPr?.(index) ?? '';
    xml += `<w:tr>${trPr ? `<w:trPr>${trPr}</w:trPr>` : ''}`;
    row.forEach((cell, column) => {
      const spec: CellSpec = typeof cell === 'string' ? { text: cell } : cell;
      const span = /w:gridSpan w:val="(\d+)"/.exec(spec.tcPr ?? '');
      const width = span
        ? widths.slice(column, column + Number(span[1])).reduce((a, b) => a + b, 0)
        : (widths[column] ?? widths[0]!);
      xml += `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${spec.tcPr ?? ''}</w:tcPr>${spec.raw ?? p(spec.text)}</w:tc>`;
    });
    xml += '</w:tr>';
  });
  return `${xml}</w:tbl>`;
}

/** An inline picture. cx/cy in EMU. */
export function inlineImage(rId: string, docPrId: number, cx = 952500, cy = 952500): string {
  return (
    `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/>` +
    `<wp:docPr id="${docPrId}" name="Picture ${docPrId}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
    `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="image${docPrId}.png"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

/** An inline VML text box (widely readable), holding plain paragraphs. */
export function textBox(paragraphs: string, id: number): string {
  return (
    `<w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="TextBox${id}" type="#_x0000_t202" ` +
    'style="width:216pt;height:72pt" strokeweight="0.5pt"><v:textbox>' +
    `<w:txbxContent>${paragraphs}</w:txbxContent></v:textbox></v:shape></w:pict></w:r>`
  );
}

export function hyperlink(rId: string, text: string): string {
  return `<w:hyperlink r:id="${rId}">${r(text, '<w:rStyle w:val="Hyperlink"/>')}</w:hyperlink>`;
}

/** A complex field with a cached result. */
export function field(instr: string, result: string, rPr = ''): string {
  const pr = rPr ? `<w:rPr>${rPr}</w:rPr>` : '';
  return (
    `<w:r>${pr}<w:fldChar w:fldCharType="begin"/></w:r>` +
    `<w:r>${pr}<w:instrText xml:space="preserve"> ${esc(instr)} </w:instrText></w:r>` +
    `<w:r>${pr}<w:fldChar w:fldCharType="separate"/></w:r>${r(result, rPr)}` +
    `<w:r>${pr}<w:fldChar w:fldCharType="end"/></w:r>`
  );
}

export function simpleField(instr: string, result: string): string {
  return `<w:fldSimple w:instr=" ${esc(instr)} ">${r(result)}</w:fldSimple>`;
}

export const footnoteRef = (id: number) =>
  `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${id}"/></w:r>`;
export const endnoteRef = (id: number) =>
  `<w:r><w:rPr><w:rStyle w:val="EndnoteReference"/></w:rPr><w:endnoteReference w:id="${id}"/></w:r>`;

/** Comment range around `inner` run content. */
export function commented(id: number, inner: string): string {
  return (
    `<w:commentRangeStart w:id="${id}"/>${inner}<w:commentRangeEnd w:id="${id}"/>` +
    `<w:r><w:commentReference w:id="${id}"/></w:r>`
  );
}

export function bookmark(id: number, name: string, inner: string): string {
  return `<w:bookmarkStart w:id="${id}" w:name="${esc(name)}"/>${inner}<w:bookmarkEnd w:id="${id}"/>`;
}

/** Inline rich-text content control. */
export function sdtRun(tag: string, inner: string, id: number): string {
  return `<w:sdt><w:sdtPr><w:alias w:val="${esc(tag)}"/><w:tag w:val="${esc(tag)}"/><w:id w:val="${id}"/></w:sdtPr><w:sdtContent>${inner}</w:sdtContent></w:sdt>`;
}

/** Block content control around paragraphs. */
export function sdtBlock(tag: string, paragraphs: string, id: number): string {
  return `<w:sdt><w:sdtPr><w:alias w:val="${esc(tag)}"/><w:tag w:val="${esc(tag)}"/><w:id w:val="${id}"/></w:sdtPr><w:sdtContent>${paragraphs}</w:sdtContent></w:sdt>`;
}

let revisionId = 900;
/** Restarts revision ids, so every build of the corpus writes the same bytes. */
export function resetRevisionIds(): void {
  revisionId = 900;
}
const revAttrs = (author: string) =>
  `w:id="${revisionId++}" w:author="${esc(author)}" w:date="2026-01-03T09:00:00Z"`;
export const insWrap = (inner: string, author = 'Earlier Reviewer') =>
  `<w:ins ${revAttrs(author)}>${inner}</w:ins>`;
export const delWrap = (inner: string, author = 'Earlier Reviewer') =>
  `<w:del ${revAttrs(author)}>${inner}</w:del>`;
export const rPrChange = (prior: string, author = 'Earlier Reviewer') =>
  `<w:rPrChange ${revAttrs(author)}><w:rPr>${prior}</w:rPr></w:rPrChange>`;

/** Section properties with overrides. */
export function sectPr(
  options: {
    width?: number;
    height?: number;
    orient?: 'landscape';
    margins?: readonly [number, number, number, number];
    cols?: number;
    type?: string;
    extra?: string;
  } = {}
): string {
  const [top, right, bottom, left] = options.margins ?? [1440, 1440, 1440, 1440];
  return (
    '<w:sectPr>' +
    (options.type ? `<w:type w:val="${options.type}"/>` : '') +
    `<w:pgSz w:w="${options.width ?? 12240}" w:h="${options.height ?? 15840}"${options.orient ? ` w:orient="${options.orient}"` : ''}/>` +
    `<w:pgMar w:top="${top}" w:right="${right}" w:bottom="${bottom}" w:left="${left}" w:header="720" w:footer="720" w:gutter="0"/>` +
    `<w:cols w:space="720"${options.cols ? ` w:num="${options.cols}"` : ''}/>` +
    (options.extra ?? '') +
    '</w:sectPr>'
  );
}
