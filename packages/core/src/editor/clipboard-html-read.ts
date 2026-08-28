// External `text/html` projected into a WordprocessingML clipboard fragment package
// (rich-clipboard-fidelity tasks 5.1-5.4, design D2).
//
// A pasted payload is attacker-controlled, so the projection reuses the bounded
// file-open trust boundary instead of trusting the markup: the HTML is size-capped
// BEFORE parse, parsed with `DOMParser` into an INERT document that is never attached
// to the live document, and walked under node-count and depth caps. This module parses;
// it is not an HTML sink — no `innerHTML`/`outerHTML`/`insertAdjacentHTML` anywhere,
// nothing executes (scripts, styles and event handlers are simply never projected),
// and nothing here fetches: hrefs pass `sanitizeHref`, images are accepted from
// bounded `data:` URIs only, and every external image source is dropped.
//
// The output is the SAME shape the internal copy lane produces — a minimal OPC zip
// readable by `readOoxmlPackage` — so the paste router feeds internal fragments and
// external HTML through one lane (`readOoxmlPackage` → merge → insertFragment).

import { sanitizeHref, escapeXml, escapeXmlAttribute } from '../store/package/sinks.ts';
import { sniffImageMime, validateRasterHeader } from '../store/package/image-resources.ts';
import { writeZip, strToU8 } from '../store/package/zip.ts';
import {
  htmlListKindAndStart,
  numberingPartXml,
  semanticHtmlListKind,
  semanticHtmlListStart,
  type HtmlListAllocation as ListAllocation,
  type HtmlListKind,
} from './clipboard-html-numbering.ts';
import { clipboardBookmarkName } from './clipboard-html-links.ts';
import {
  applyParaCss,
  applyRunCss,
  applyWordParagraphAlignment,
  imageDimensionPx,
  isElement,
  isWordClipboardHtml,
  parseInlineStyle,
  tagOf,
  wordClassAlignmentsFromDocument,
  wordParagraphStyleId,
  type HtmlParagraphAlign,
  type HtmlParaProps,
  type HtmlRunProps,
} from './clipboard-html-styles.ts';
import {
  cellCssPropertiesXml,
  htmlSpanOf,
  tableBordersXml,
  tableColumnWidths,
  tableJustification,
  tableRowsOf,
  tableRowPropertiesXml,
  tableSpanWidth,
  tableWidthTwips,
} from './clipboard-html-table-styles.ts';

export interface HtmlProjectionLimits {
  /** UTF-8 size cap applied BEFORE parse. Default 4 MiB. */
  readonly maxHtmlBytes?: number;
  /** Walk cap: nodes visited past this stop contributing. Default 100,000. */
  readonly maxNodes?: number;
  /** Walk cap: children below this depth are not entered. Default 64. */
  readonly maxDepth?: number;
  /** Decoded per-image byte cap for `data:` URIs. Default 2 MiB. */
  readonly maxImageBytes?: number;
}

export type HtmlProjectionResult =
  | {
      readonly ok: true;
      /** A fragment package zip, readable by `readOoxmlPackage`. */
      readonly fragmentBytes: Uint8Array;
      /** True when the final projected paragraph carries a mapped Word style. */
      readonly lastMarkCovered: boolean;
      /** How many `data:` images the projection accepted into the fragment. */
      readonly imageCount: number;
    }
  | { readonly ok: false; readonly reason: 'too-large' | 'no-content' | 'parse-unavailable' };

const DEFAULT_MAX_HTML_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_NODES = 100_000;
const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP_NS = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture';
const RELS_XMLNS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT_XMLNS = 'http://schemas.openxmlformats.org/package/2006/content-types';

const DOCUMENT_CT =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';
const NUMBERING_CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml';
const RELS_CT = 'application/vnd.openxmlformats-package.relationships+xml';

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Whole elements that never contribute anything to the projection. */
const IGNORED_TAGS = new Set(
  (
    'script style head template iframe object embed noscript svg math ' +
    'meta link title base select textarea'
  ).split(' ')
);

/** Heading direct formatting: bold plus these sizes in half-points (h1=32pt … h6=14pt). */
const HEADING_SZ: Record<string, number> = { h1: 64, h2: 52, h3: 44, h4: 36, h5: 32, h6: 28 };

const PARAGRAPH_TAGS = new Set('p div h1 h2 h3 h4 h5 h6 li blockquote pre'.split(' '));

/** Structural containers whose children flow through transparently. */
const CONTAINER_TAGS = new Set(
  'thead tbody tfoot tr section article main header footer aside nav figure form body html'.split(
    ' '
  )
);

type RunProps = HtmlRunProps;
type ParaProps = HtmlParaProps;

type ListState = { readonly numId: string; readonly level: number };

type RelEntry = {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
};

interface FlowContext {
  readonly run: RunProps;
  readonly para: ParaProps;
  readonly paragraphMarkCovered: boolean;
  readonly pre: boolean;
  readonly list: ListState | null;
}

interface Projection {
  nodesLeft: number;
  readonly maxDepth: number;
  readonly maxImageBytes: number;
  readonly wordHtml: boolean;
  lastMarkCovered: boolean;
  readonly rels: RelEntry[];
  readonly media: Map<string, Uint8Array>;
  readonly mediaExtensions: Map<string, string>;
  readonly lists: Map<string, ListAllocation>;
  semanticListCount: number;
  imageCount: number;
  docPrId: number;
  nextBookmarkId: number;
  readonly classAlignments: ReadonlyMap<string, HtmlParagraphAlign>;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

// --- XML emission

/** Drop code units XML 1.0 forbids in run text; mirrors the store's `isValidXmlText`. */
function xmlSafeText(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    if (unit !== 0x09 && (unit < 0x20 || unit === 0xfffe || unit === 0xffff)) continue;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i]! + text[i + 1]!;
        i += 1;
      }
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) continue;
    out += text[i]!;
  }
  return out;
}

/** `w:rPr`, children in CT_RPr sequence order. */
function rPrXml(props: RunProps): string {
  let inner = '';
  if (props.font !== undefined) {
    const face = escapeXmlAttribute(xmlSafeText(props.font));
    inner += `<w:rFonts w:ascii="${face}" w:hAnsi="${face}"/>`;
  }
  if (props.bold) inner += '<w:b/>';
  if (props.italic) inner += '<w:i/>';
  if (props.strike) inner += '<w:strike/>';
  if (props.color !== undefined) inner += `<w:color w:val="${props.color}"/>`;
  if (props.szHalfPoints !== undefined) inner += `<w:sz w:val="${props.szHalfPoints}"/>`;
  if (props.highlight !== undefined) {
    inner += `<w:highlight w:val="${escapeXmlAttribute(props.highlight)}"/>`;
  }
  if (props.underline) inner += '<w:u w:val="single"/>';
  if (props.shdFill !== undefined) {
    inner += `<w:shd w:val="clear" w:color="auto" w:fill="${props.shdFill}"/>`;
  }
  if (props.vertAlign !== undefined) inner += `<w:vertAlign w:val="${props.vertAlign}"/>`;
  return inner.length > 0 ? `<w:rPr>${inner}</w:rPr>` : '';
}

function textRunXml(text: string, props: RunProps): string {
  return `<w:r>${rPrXml(props)}<w:t xml:space="preserve">${escapeXml(xmlSafeText(text))}</w:t></w:r>`;
}

/** `w:pPr`, children in CT_PPr sequence order. */
function pPrXml(para: ParaProps): string {
  let inner = '';
  if (para.styleId !== undefined) {
    inner += `<w:pStyle w:val="${escapeXmlAttribute(para.styleId)}"/>`;
  }
  if (para.keepNext) inner += '<w:keepNext/>';
  if (para.keepLines) inner += '<w:keepLines/>';
  if (para.pageBreakBefore) inner += '<w:pageBreakBefore/>';
  if (para.widowControl) inner += '<w:widowControl/>';
  if (para.numPr) {
    inner +=
      `<w:numPr><w:ilvl w:val="${para.numPr.ilvl}"/>` +
      `<w:numId w:val="${escapeXmlAttribute(para.numPr.numId)}"/></w:numPr>`;
  }
  if (para.borders !== undefined) {
    let borders = '';
    for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
      const border = para.borders[edge];
      if (border === undefined) continue;
      borders +=
        `<w:${edge} w:val="${border.val}" w:sz="${border.szEighthPoints}" ` +
        `w:space="0" w:color="${border.color}"/>`;
    }
    if (borders.length > 0) inner += `<w:pBdr>${borders}</w:pBdr>`;
  }
  if (para.shdFill !== undefined) {
    inner += `<w:shd w:val="clear" w:color="auto" w:fill="${para.shdFill}"/>`;
  }
  if (para.tabs !== undefined && para.tabs.length > 0) {
    inner += `<w:tabs>${para.tabs
      .map(
        (tab) =>
          `<w:tab w:val="${tab.val}" w:pos="${tab.posTwips}"` +
          (tab.leader === undefined ? '/>' : ` w:leader="${tab.leader}"/>`)
      )
      .join('')}</w:tabs>`;
  }
  if (
    para.spacingBeforeTwips !== undefined ||
    para.spacingAfterTwips !== undefined ||
    para.lineTwentieths !== undefined
  ) {
    let spacing = '<w:spacing';
    if (para.spacingBeforeTwips !== undefined) {
      spacing += ` w:before="${para.spacingBeforeTwips}"`;
    }
    if (para.spacingAfterTwips !== undefined) {
      spacing += ` w:after="${para.spacingAfterTwips}"`;
    }
    if (para.lineTwentieths !== undefined) {
      spacing += ` w:line="${para.lineTwentieths}" w:lineRule="auto"`;
    }
    inner += `${spacing}/>`;
  }
  const first = para.firstLineTwips;
  if (para.indLeftTwips !== undefined || para.indRightTwips !== undefined || first !== undefined) {
    let ind = '<w:ind';
    if (para.indLeftTwips !== undefined) ind += ` w:left="${para.indLeftTwips}"`;
    if (para.indRightTwips !== undefined) ind += ` w:right="${para.indRightTwips}"`;
    if (first !== undefined) {
      ind += first >= 0 ? ` w:firstLine="${first}"` : ` w:hanging="${-first}"`;
    }
    inner += `${ind}/>`;
  }
  if (para.jc !== undefined) inner += `<w:jc w:val="${para.jc}"/>`;
  return inner.length > 0 ? `<w:pPr>${inner}</w:pPr>` : '';
}

function paragraphXml(para: ParaProps, runs: readonly string[]): string {
  return `<w:p>${pPrXml(para)}${runs.join('')}</w:p>`;
}

// --- Images: bounded base64 `data:` URIs only, never a fetch

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Strict bounded base64 decode: the size cap applies BEFORE any allocation. */
function decodeBase64(data: string, maxBytes: number): Uint8Array | null {
  if (data.length === 0 || data.length % 4 !== 0) return null;
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  const byteLength = (data.length / 4) * 3 - padding;
  if (byteLength <= 0 || byteLength > maxBytes) return null;
  const out = new Uint8Array(byteLength);
  let at = 0;
  for (let i = 0; i < data.length; i += 4) {
    let chunk = 0;
    let bits = 0;
    for (let j = 0; j < 4; j += 1) {
      const code = data.charCodeAt(i + j);
      if (code === 0x3d) {
        // `=` only in the final positions.
        if (i + j < data.length - padding) return null;
        continue;
      }
      const value = code < 128 ? BASE64_LOOKUP[code]! : -1;
      if (value < 0) return null;
      chunk = (chunk << 6) | value;
      bits += 6;
    }
    chunk <<= 24 - bits;
    if (bits >= 12) out[at++] = (chunk >>> 16) & 0xff;
    if (bits >= 18) out[at++] = (chunk >>> 8) & 0xff;
    if (bits >= 24) out[at++] = chunk & 0xff;
  }
  return at === byteLength ? out : null;
}

const DATA_IMAGE_RE = /^data:image\/(?:png|jpeg|jpg|gif|emf);base64,([A-Za-z0-9+/=]+)$/i;

/** Project a `data:` image into a media part + rel + inline `w:drawing` run. */
function projectImage(element: Element, runs: string[], p: Projection): void {
  const src = element.getAttribute('src');
  if (src === null || src.length > p.maxImageBytes * 2) return;
  const match = DATA_IMAGE_RE.exec(src);
  if (!match) return; // External/blob/http sources drop with no fetch.
  const bytes = decodeBase64(match[1]!, p.maxImageBytes);
  if (bytes === null) return;
  const sniffed = sniffImageMime(bytes);
  if (sniffed !== 'image/png' && sniffed !== 'image/jpeg' && sniffed !== 'image/gif') return;
  const header = validateRasterHeader(bytes, sniffed);

  const style = parseInlineStyle(element);
  let widthPx = imageDimensionPx(element, style, 'width', p.wordHtml);
  let heightPx = imageDimensionPx(element, style, 'height', p.wordHtml);
  if (widthPx === null && heightPx === null && header) {
    widthPx = (header.pixelWidth * 96) / (header.dpiX ?? 96);
    heightPx = (header.pixelHeight * 96) / (header.dpiY ?? 96);
  } else if (widthPx !== null && heightPx === null) {
    heightPx = header ? (widthPx * header.pixelHeight) / header.pixelWidth : (widthPx * 2) / 3;
  } else if (widthPx === null && heightPx !== null) {
    widthPx = header ? (heightPx * header.pixelWidth) / header.pixelHeight : (heightPx * 3) / 2;
  }
  // Unknown extent falls back to 300x200pt.
  const cx = widthPx === null ? 3_810_000 : clamp(Math.round(widthPx * 9525), 9525, 30_000_000);
  const cy = heightPx === null ? 2_540_000 : clamp(Math.round(heightPx * 9525), 9525, 30_000_000);

  const extension = sniffed === 'image/png' ? 'png' : sniffed === 'image/gif' ? 'gif' : 'jpeg';
  p.imageCount += 1;
  p.media.set(`word/media/image${p.imageCount}.${extension}`, bytes);
  if (!p.mediaExtensions.has(extension)) p.mediaExtensions.set(extension, sniffed);
  const relId = allocateRel(p, `${R_NS}/image`, `media/image${p.imageCount}.${extension}`, false);
  p.docPrId += 1;
  runs.push(
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${p.docPrId}" name=""/>` +
      `<wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="${PIC_NS}"><pic:pic>` +
      '<pic:nvPicPr><pic:cNvPr id="0" name="" descr=""/><pic:cNvPicPr/></pic:nvPicPr>' +
      `<pic:blipFill><a:blip r:embed="${relId}"/>` +
      '<a:srcRect/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
  );
}

// --- Allocation

function allocateRel(p: Projection, type: string, target: string, external: boolean): string {
  const id = `rId${p.rels.length + 1}`;
  p.rels.push({ id, type, target, external });
  return id;
}

function allocateList(p: Projection, key: string, kind: HtmlListKind, start = 1): string {
  const existing = p.lists.get(key);
  if (existing) return existing.numId;
  const numId = String(1001 + p.lists.size);
  p.lists.set(key, { numId, kind, start });
  return numId;
}

// --- Walk

/** True for the literal marker span Word emits beside `mso-list` paragraphs. */
function isMsoListIgnoreMarker(style: ReadonlyMap<string, string>): boolean {
  const value = style.get('mso-list');
  return value !== undefined && value.toLowerCase().includes('ignore');
}

function applyInlineTag(base: RunProps, tag: string): RunProps {
  if (tag === 'b' || tag === 'strong') return { ...base, bold: true };
  if (tag === 'i' || tag === 'em') return { ...base, italic: true };
  if (tag === 'u' || tag === 'ins') return { ...base, underline: true };
  if (tag === 's' || tag === 'strike' || tag === 'del') return { ...base, strike: true };
  if (tag === 'sub') return { ...base, vertAlign: 'subscript' };
  if (tag === 'sup') return { ...base, vertAlign: 'superscript' };
  if (tag === 'code' || tag === 'tt' || tag === 'kbd' || tag === 'samp') {
    return { ...base, font: 'Courier New' };
  }
  return base;
}

function positionalTabXml(element: Element, props: RunProps): string {
  const alignment = element.getAttribute('alignment')?.trim().toLowerCase();
  const relativeTo = element.getAttribute('relativeto')?.trim().toLowerCase();
  const leader = element.getAttribute('leader')?.trim().toLowerCase();
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') return '';
  if (relativeTo !== 'margin' && relativeTo !== 'indent') return '';
  if (
    leader !== 'none' &&
    leader !== 'dot' &&
    leader !== 'hyphen' &&
    leader !== 'underscore' &&
    leader !== 'middledot'
  ) {
    return '';
  }
  const normalizedLeader = leader === 'middledot' ? 'middleDot' : leader;
  return (
    `<w:r>${rPrXml(props)}<w:ptab w:alignment="${alignment}" ` +
    `w:relativeTo="${relativeTo}" w:leader="${normalizedLeader}"/></w:r>`
  );
}

const TAB_RUN_CONTENTS = [
  '',
  '<w:tab/>',
  '<w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/>',
  '<w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/><w:tab/>',
] as const;

function collectInline(
  node: Node,
  depth: number,
  ctx: FlowContext,
  runs: string[],
  p: Projection
): void {
  if (p.nodesLeft <= 0 || depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  if (node.nodeType === 3 /* TEXT_NODE */) {
    const raw = node.nodeValue ?? '';
    if (ctx.pre) {
      const parts = raw.replace(/\r\n?/g, '\n').split('\n');
      parts.forEach((part, index) => {
        if (index > 0) runs.push(`<w:r>${rPrXml(ctx.run)}<w:br/></w:r>`);
        if (part.length > 0) runs.push(textRunXml(part, ctx.run));
      });
      return;
    }
    const collapsed = raw.replace(/\s+/g, ' ');
    if (collapsed.length === 0) return;
    if (collapsed === ' ' && runs.length === 0) return; // Whitespace between blocks.
    runs.push(textRunXml(collapsed, ctx.run));
    return;
  }
  if (!isElement(node)) return;
  const tag = tagOf(node);
  if (IGNORED_TAGS.has(tag)) return;
  const style = parseInlineStyle(node);
  if (isMsoListIgnoreMarker(style)) return; // Word's literal list marker never becomes text.
  if (tag === 'w:ptab') {
    const tab = positionalTabXml(node, ctx.run);
    if (tab.length > 0) runs.push(tab);
    return;
  }
  const tabCount = style.get('mso-tab-count');
  const tabContent =
    tabCount !== undefined && /^\d$/.test(tabCount.trim())
      ? TAB_RUN_CONTENTS[Number.parseInt(tabCount, 10)]
      : undefined;
  if (tabContent !== undefined && tabContent.length > 0) {
    runs.push(`<w:r>${rPrXml(ctx.run)}${tabContent}</w:r>`);
    return;
  }
  if (tag === 'br') {
    const pageBreak =
      style.get('page-break-before')?.trim().toLowerCase() === 'always' ||
      style.get('break-before')?.trim().toLowerCase() === 'page';
    runs.push(`<w:r>${rPrXml(ctx.run)}${pageBreak ? '<w:br w:type="page"/>' : '<w:br/>'}</w:r>`);
    return;
  }
  if (tag === 'img') {
    projectImage(node, runs, p);
    return;
  }
  const nextCtx: FlowContext = {
    ...ctx,
    run: applyRunCss(applyInlineTag(ctx.run, tag), style),
    pre: ctx.pre || tag === 'pre',
  };
  if (tag === 'a') {
    const href = node.getAttribute('href');
    const bookmarkName = clipboardBookmarkName(
      node.getAttribute('name') ?? node.getAttribute('id')
    );
    const inner: string[] = [];
    for (const child of Array.from(node.childNodes)) {
      collectInline(child, depth + 1, nextCtx, inner, p);
    }
    const anchor = href?.startsWith('#') ? clipboardBookmarkName(href.slice(1)) : null;
    let content = inner.join('');
    if (href?.startsWith('#')) {
      if (anchor !== null) {
        content = `<w:hyperlink w:anchor="${escapeXmlAttribute(anchor)}">${content}</w:hyperlink>`;
      }
    } else {
      const sanitized = href === null ? null : sanitizeHref(href);
      if (sanitized !== null && sanitized.ok && sanitized.href.length > 0) {
        const relId = allocateRel(p, `${R_NS}/hyperlink`, sanitized.href, true);
        content = `<w:hyperlink r:id="${relId}">${content}</w:hyperlink>`;
      }
    }
    if (bookmarkName !== null) {
      const id = String(p.nextBookmarkId++);
      content =
        `<w:bookmarkStart w:id="${id}" w:name="${escapeXmlAttribute(bookmarkName)}"/>` +
        `${content}<w:bookmarkEnd w:id="${id}"/>`;
    }
    runs.push(content);
    return;
  }
  for (const child of Array.from(node.childNodes)) {
    collectInline(child, depth + 1, nextCtx, runs, p);
  }
}

/** Word desktop's `mso-list:l<N> level<M> lfo<K>` convention on `MsoListParagraph`. */
function msoListNumPr(
  element: Element,
  style: ReadonlyMap<string, string>,
  p: Projection
): ParaProps['numPr'] {
  const declaration = style.get('mso-list');
  if (declaration === undefined) return undefined;
  const match = /\bl(\d{1,4})\s+level(\d{1,2})\b/i.exec(declaration);
  if (!match) return undefined;
  const ilvl = clamp(Number.parseInt(match[2]!, 10) - 1, 0, 8);
  const marker = msoMarkerText(element, p);
  const { kind, start } = htmlListKindAndStart(marker);
  return { numId: allocateList(p, `mso:l${match[1]}`, kind, start), ilvl };
}

/** The text of the `mso-list:Ignore` marker span, for number-vs-bullet detection. */
function msoMarkerText(element: Element, p: Projection): string {
  let found = '';
  const walk = (node: Node, depth: number): void => {
    if (found.length > 0 || depth > 8 || p.nodesLeft <= 0) return;
    if (!isElement(node)) return;
    if (isMsoListIgnoreMarker(parseInlineStyle(node))) {
      found = (node.textContent ?? '').slice(0, 16);
      return;
    }
    for (const child of Array.from(node.childNodes)) walk(child, depth + 1);
  };
  for (const child of Array.from(element.childNodes)) walk(child, 0);
  return found;
}

function projectParagraph(
  element: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[]
): void {
  if (p.nodesLeft <= 0 || depth > p.maxDepth) return;
  const tag = tagOf(element);
  const style = parseInlineStyle(element);
  const para: ParaProps = {};
  const styleId = wordParagraphStyleId(element, p.wordHtml);
  if (styleId !== undefined) para.styleId = styleId;
  if (ctx.para.numPr) para.numPr = ctx.para.numPr;
  if (ctx.para.jc) para.jc = ctx.para.jc;
  let run = { ...ctx.run };
  const heading = HEADING_SZ[tag];
  if (heading !== undefined && styleId === undefined) {
    run.bold = true;
    run.szHalfPoints = heading;
  }
  const pre = ctx.pre || tag === 'pre';
  if (tag === 'pre') run.font = 'Courier New';
  const mso = msoListNumPr(element, style, p);
  if (mso) para.numPr = mso;
  applyWordParagraphAlignment(para, element, p.classAlignments);
  applyParaCss(para, style);
  const runStyle = new Map(style);
  runStyle.delete('background');
  runStyle.delete('background-color');
  run = applyRunCss(run, runStyle);
  const next: FlowContext = {
    run,
    para,
    paragraphMarkCovered: styleId !== undefined,
    pre,
    list: ctx.list,
  };
  projectFlow(Array.from(element.childNodes), depth + 1, next, p, out, true);
}

function projectList(
  element: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[]
): void {
  if (p.nodesLeft <= 0 || depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  const kind = semanticHtmlListKind(element);
  // One numId per distinct top-level list; nested lists share their root's definition.
  if (!ctx.list) p.semanticListCount += 1;
  const state: ListState = ctx.list
    ? { numId: ctx.list.numId, level: Math.min(ctx.list.level + 1, 8) }
    : {
        numId: allocateList(p, `sem:${p.semanticListCount}`, kind, semanticHtmlListStart(element)),
        level: 0,
      };
  const itemCtx: FlowContext = {
    ...ctx,
    list: state,
    para: { numPr: { numId: state.numId, ilvl: state.level } },
  };
  for (const child of Array.from(element.childNodes)) {
    if (!isElement(child)) continue;
    const childTag = tagOf(child);
    if (childTag === 'li') projectParagraph(child, depth + 1, itemCtx, p, out);
    else if (childTag === 'ol' || childTag === 'ul') {
      projectList(child, depth + 1, { ...ctx, list: state }, p, out);
    }
  }
}

function projectFlow(
  nodes: readonly Node[],
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[],
  forceEmit = false
): void {
  // Container chains (`<section>` in `<section>` …) recurse here too; without the cap a
  // deep chain overflowed the stack instead of degrading.
  if (depth > p.maxDepth) return;
  const before = out.length;
  let pending: string[] = [];
  const flush = (): void => {
    if (pending.length > 0) {
      out.push(paragraphXml(ctx.para, pending));
      p.lastMarkCovered = ctx.paragraphMarkCovered;
    }
    pending = [];
  };
  for (const node of nodes) {
    if (p.nodesLeft <= 0) break;
    if (isElement(node)) {
      const tag = tagOf(node);
      if (IGNORED_TAGS.has(tag)) {
        p.nodesLeft -= 1;
        continue;
      }
      if (PARAGRAPH_TAGS.has(tag)) {
        flush();
        p.nodesLeft -= 1;
        projectParagraph(node, depth, ctx, p, out);
        continue;
      }
      if (tag === 'ol' || tag === 'ul') {
        flush();
        projectList(node, depth, ctx, p, out);
        continue;
      }
      if (tag === 'table') {
        flush();
        projectTable(node, depth, ctx, p, out);
        continue;
      }
      if (CONTAINER_TAGS.has(tag)) {
        flush();
        p.nodesLeft -= 1;
        projectFlow(Array.from(node.childNodes), depth + 1, ctx, p, out);
        continue;
      }
    }
    collectInline(node, depth, ctx, pending, p);
  }
  flush();
  // An explicit block emits its paragraph even when empty.
  if (forceEmit && out.length === before) {
    out.push(paragraphXml(ctx.para, []));
    p.lastMarkCovered = ctx.paragraphMarkCovered;
  }
}

// --- Tables

const TABLE_TOTAL_TWIPS = 9360; // 6.5 inches, Word's default content width.

type RowSpanCarry = { remaining: number; readonly span: number };

function projectTable(
  table: Element,
  depth: number,
  ctx: FlowContext,
  p: Projection,
  out: string[]
): void {
  if (p.nodesLeft <= 0 || depth > p.maxDepth) return;
  p.nodesLeft -= 1;
  const rows = tableRowsOf(table);
  if (rows.length === 0) return;

  let columns = 1;
  for (const row of rows) {
    let count = 0;
    for (const cell of Array.from(row.children)) {
      if (/^t[dh]$/.test(tagOf(cell))) count += htmlSpanOf(cell, 'colspan', 63);
    }
    columns = Math.max(columns, count);
  }
  columns = Math.min(columns, 63);

  const totalWidth = tableWidthTwips(table, TABLE_TOTAL_TWIPS);
  const columnWidths = tableColumnWidths(rows, columns, totalWidth);
  const borders = tableBordersXml(table);
  const justification = tableJustification(table);
  const jc = justification === undefined ? '' : `<w:jc w:val="${justification}"/>`;
  const grid = columnWidths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');

  const carry: Array<RowSpanCarry | null> = new Array<RowSpanCarry | null>(columns).fill(null);
  const rowXml: string[] = [];
  for (const row of rows) {
    if (p.nodesLeft <= 0) break;
    p.nodesLeft -= 1;
    const sourceCells = Array.from(row.children).filter((cell) => /^t[dh]$/.test(tagOf(cell)));
    let sourceAt = 0;
    const cells: string[] = [];
    let column = 0;
    while (column < columns) {
      // Every emitted cell — carried continuation and missing-cell fill included — charges
      // the node budget: the fill loop synthesizes up to 63 cells per row, and uncharged
      // fills let a small payload amplify into hundreds of megabytes of strings.
      p.nodesLeft -= 1;
      if (p.nodesLeft <= 0) break;
      const carried = carry[column];
      if (carried) {
        const span = carried.span;
        const gridSpan = span > 1 ? `<w:gridSpan w:val="${span}"/>` : '';
        cells.push(
          `<w:tc><w:tcPr><w:tcW w:w="${tableSpanWidth(columnWidths, column, span)}" w:type="dxa"/>` +
            `${gridSpan}<w:vMerge/></w:tcPr><w:p/></w:tc>`
        );
        carried.remaining -= 1;
        if (carried.remaining <= 0) carry[column] = null;
        column += span;
        continue;
      }
      const cell = sourceCells[sourceAt];
      if (cell === undefined) {
        cells.push(
          `<w:tc><w:tcPr><w:tcW w:w="${columnWidths[column]}" w:type="dxa"/></w:tcPr><w:p/></w:tc>`
        );
        column += 1;
        continue;
      }
      sourceAt += 1;
      const span = Math.min(htmlSpanOf(cell, 'colspan', 63), columns - column);
      const rowSpan = htmlSpanOf(cell, 'rowspan', 1000);
      if (rowSpan > 1) carry[column] = { remaining: rowSpan - 1, span };
      cells.push(
        projectCell(
          cell,
          span,
          tableSpanWidth(columnWidths, column, span),
          rowSpan > 1,
          depth,
          ctx,
          p
        )
      );
      column += span;
    }
    rowXml.push(`<w:tr>${tableRowPropertiesXml(row)}${cells.join('')}</w:tr>`);
  }

  out.push(
    `<w:tbl><w:tblPr><w:tblW w:w="${totalWidth}" w:type="dxa"/>${jc}${borders}</w:tblPr>` +
      `<w:tblGrid>${grid}</w:tblGrid>${rowXml.join('')}</w:tbl>`
  );
  p.lastMarkCovered = false;
}

function projectCell(
  cell: Element,
  span: number,
  width: number,
  vMergeRestart: boolean,
  depth: number,
  ctx: FlowContext,
  p: Projection
): string {
  const isHeader = tagOf(cell) === 'th';
  let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
  if (span > 1) tcPr += `<w:gridSpan w:val="${span}"/>`;
  if (vMergeRestart) tcPr += '<w:vMerge w:val="restart"/>';
  tcPr += cellCssPropertiesXml(cell);

  const cellCtx: FlowContext = {
    run: isHeader ? { ...ctx.run, bold: true } : ctx.run,
    para: isHeader ? { jc: 'center' } : {},
    paragraphMarkCovered: false,
    pre: false,
    list: null,
  };
  const blocks: string[] = [];
  projectFlow(Array.from(cell.childNodes), depth + 2, cellCtx, p, blocks, true);
  // A cell must end with a paragraph.
  if (blocks.length === 0 || blocks[blocks.length - 1]!.endsWith('</w:tbl>')) {
    blocks.push('<w:p/>');
  }
  return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${blocks.join('')}</w:tc>`;
}

// --- Zip assembly (entry names mirror the internal fragment extractor)

function relationshipXml(rels: readonly RelEntry[]): string {
  const rows = rels
    .map(
      (rel) =>
        `<Relationship Id="${escapeXmlAttribute(rel.id)}" Type="${escapeXmlAttribute(rel.type)}" ` +
        `Target="${escapeXmlAttribute(rel.target)}"${rel.external ? ' TargetMode="External"' : ''}/>`
    )
    .join('');
  return `${XML_DECL}<Relationships xmlns="${RELS_XMLNS}">${rows}</Relationships>`;
}

function assembleFragment(p: Projection, blocks: readonly string[]): Uint8Array {
  const entries = new Map<string, Uint8Array>();
  const hasNumbering = p.lists.size > 0;
  if (hasNumbering) allocateRel(p, `${R_NS}/numbering`, 'numbering.xml', false);

  const documentXml =
    `${XML_DECL}<w:document xmlns:w="${WML_NS}" xmlns:r="${R_NS}" xmlns:wp="${WP_NS}" ` +
    `xmlns:a="${A_NS}" xmlns:pic="${PIC_NS}"><w:body>${blocks.join('')}</w:body></w:document>`;
  entries.set('word/document.xml', strToU8(documentXml));
  entries.set('word/_rels/document.xml.rels', strToU8(relationshipXml(p.rels)));
  const rootRel = {
    id: 'rId1',
    type: `${R_NS}/officeDocument`,
    target: 'word/document.xml',
    external: false,
  };
  entries.set('_rels/.rels', strToU8(relationshipXml([rootRel])));
  if (hasNumbering) {
    entries.set('word/numbering.xml', strToU8(numberingPartXml([...p.lists.values()])));
  }
  for (const [name, bytes] of p.media) entries.set(name, bytes);

  let defaults =
    `<Default Extension="rels" ContentType="${RELS_CT}"/>` +
    '<Default Extension="xml" ContentType="application/xml"/>';
  for (const [extension, contentType] of p.mediaExtensions) {
    defaults += `<Default Extension="${extension}" ContentType="${contentType}"/>`;
  }
  const overrides =
    `<Override PartName="/word/document.xml" ContentType="${DOCUMENT_CT}"/>` +
    (hasNumbering
      ? `<Override PartName="/word/numbering.xml" ContentType="${NUMBERING_CT}"/>`
      : '');
  entries.set(
    '[Content_Types].xml',
    strToU8(`${XML_DECL}<Types xmlns="${CT_XMLNS}">${defaults}${overrides}</Types>`)
  );
  return writeZip(entries);
}

// --- Entry point

type ProjectedBlocks =
  | { readonly ok: true; readonly projection: Projection; readonly blocks: string[] }
  | { readonly ok: false; readonly reason: 'too-large' | 'no-content' | 'parse-unavailable' };

/** The shared parse-and-walk half: everything up to (but not including) zip assembly. */
function projectBlocks(html: string, limits: HtmlProjectionLimits): ProjectedBlocks {
  const maxHtmlBytes = limits.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES;
  // UTF-16 length is a lower bound on UTF-8 bytes, so the cheap check refuses first;
  // borderline payloads get an exact byte count.
  if (html.length > maxHtmlBytes) return { ok: false, reason: 'too-large' };
  if (html.length * 3 > maxHtmlBytes) {
    const byteLength = new TextEncoder().encode(html).byteLength;
    if (byteLength > maxHtmlBytes) return { ok: false, reason: 'too-large' };
  }
  if (typeof DOMParser === 'undefined') return { ok: false, reason: 'parse-unavailable' };
  let parsed: Document;
  try {
    // The result stays detached. The bounded allowlist walker emits escaped XML only.
    // codeql[js/xss]
    parsed = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return { ok: false, reason: 'parse-unavailable' };
  }
  const body = parsed.body;
  if (!body) return { ok: false, reason: 'no-content' };

  const projection: Projection = {
    nodesLeft: limits.maxNodes ?? DEFAULT_MAX_NODES,
    maxDepth: limits.maxDepth ?? DEFAULT_MAX_DEPTH,
    maxImageBytes: limits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    wordHtml: isWordClipboardHtml(html),
    lastMarkCovered: false,
    rels: [],
    media: new Map(),
    mediaExtensions: new Map(),
    lists: new Map(),
    semanticListCount: 0,
    imageCount: 0,
    docPrId: 0,
    nextBookmarkId: 1,
    classAlignments: wordClassAlignmentsFromDocument(parsed),
  };
  const blocks: string[] = [];
  const rootCtx: FlowContext = {
    run: {},
    para: {},
    paragraphMarkCovered: false,
    pre: false,
    list: null,
  };
  projectFlow(Array.from(body.childNodes), 0, rootCtx, projection, blocks);
  if (blocks.length === 0) return { ok: false, reason: 'no-content' };
  return { ok: true, projection, blocks };
}

/**
 * Project external `text/html` into a WordprocessingML fragment package.
 *
 * Pure over its input: parses into an inert document, walks under caps, and returns
 * fragment bytes the paste router reads through `readOoxmlPackage`. Never attaches
 * parsed nodes anywhere, never fetches, never executes.
 */
export function projectExternalHtml(
  html: string,
  limits: HtmlProjectionLimits = {}
): HtmlProjectionResult {
  const projected = projectBlocks(html, limits);
  if (!projected.ok) return projected;
  return {
    ok: true,
    fragmentBytes: assembleFragment(projected.projection, projected.blocks),
    lastMarkCovered: projected.projection.lastMarkCovered,
    imageCount: projected.projection.imageCount,
  };
}

/**
 * What the projection WOULD land, without paying for zip assembly.
 *
 * The file-lane stand-down predicate asks this per paste gesture; running the full
 * projection just to read a boolean doubled the parse-and-deflate cost of every
 * image-bearing paste (the router runs the real projection right after).
 */
export function probeExternalHtml(
  html: string,
  limits: HtmlProjectionLimits = {}
): { readonly lands: boolean; readonly imageCount: number } {
  const projected = projectBlocks(html, limits);
  if (!projected.ok) return { lands: false, imageCount: 0 };
  return { lands: true, imageCount: projected.projection.imageCount };
}
