// Serializes a clipboard fragment package — the miniature WordprocessingML OPC zip the copy
// lane produces — into the visible half of the `text/html` flavour. Structure comes from the
// canonical tree (headings, real lists, tables, anchors); formatting comes from a small
// self-contained cascade over the FRAGMENT's own styles part, emitted as inline CSS so Word
// and Google Docs need no stylesheet.
//
// Security posture: the fragment is read through the bounded `readOoxmlPackage` trust
// boundary, and this writer is a pure string builder — no DOM APIs, no insertion sinks.
// Every file-derived value is escaped or allowlist-validated before it reaches the output.

import { readOoxmlPackage, type OoxmlPackage } from '../store/package/ooxml-package.ts';
import {
  WML_NAMESPACE_URI,
  WP_NAMESPACE_URI,
  DRAWINGML_MAIN_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { relationshipsOf } from '../store/package/package-edit.ts';
import { resolveInternalTarget } from '../store/package/opc-names.ts';
import type { RelationshipRecord } from '../store/package/relationships.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { clipboardBase64Of } from './clipboard-html-base64.ts';
import {
  foldAttribute,
  lastProperty,
  paragraphPropertySources,
  relatedPart,
  runPropertyLayers,
  runToggleOn,
  styleChain,
  styleIndexOf,
  toggleOn,
  type RunPropertyLayers,
  type StyleIndex,
} from './clipboard-html-write-cascade.ts';
import {
  attrOf,
  cssHexColor,
  escapeAttr,
  escapeHtml,
  findDescendant,
  isElement,
  parseIntValue,
  ptFromTwips,
  textUnder,
  wmlChild,
  wmlVal,
} from './clipboard-html-write-tree.ts';
import { clipboardBookmarkName, clipboardHyperlinkTarget } from './clipboard-html-links.ts';
import { clipboardLanguageTag } from './clipboard-html-language.ts';
import { htmlNumberingIndexOf, type HtmlNumberingIndex } from './clipboard-html-write-numbering.ts';
import { wordTableCellCss } from './clipboard-html-write-table-styles.ts';
import {
  WORD_HIGHLIGHT_COLORS,
  WORD_JC_TO_TEXT_ALIGN,
  wordBorderCss,
  wordCssFontFamily,
  wordLineSpacingCss,
  wordNoteReferenceHtml,
  wordParagraphClassOf,
  wordPositionalTabHtml,
  wordTableRowCss,
  wordUnderlineCss,
  type WordNoteBodyContext,
} from './clipboard-html-word-elements.ts';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NUMBERING_REL = `${R_NS}/numbering`;
const FOOTNOTES_REL = `${R_NS}/footnotes`;
const ENDNOTES_REL = `${R_NS}/endnotes`;

const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const EMU_PER_PX = 9525;

export interface InteropHtmlOptions {
  /** Per-image data: URI budget, bytes of source media. Default 2 MiB. */
  readonly maxImageBytes?: number;
  /** Total image budget. Default 8 MiB. Images beyond either budget are omitted. */
  readonly maxTotalImageBytes?: number;
}

interface RunCss {
  readonly css: string;
  readonly vanish: boolean;
  readonly vertAlign: 'superscript' | 'subscript' | null;
  readonly lang: string | null;
  readonly rtl: boolean;
}

function runCssOf(layers: RunPropertyLayers): RunCss {
  const sources = layers.all;
  if (runToggleOn(layers, 'vanish')) {
    return { css: '', vanish: true, vertAlign: null, lang: null, rtl: false };
  }
  const rules: string[] = [];

  const font =
    foldAttribute(sources, 'rFonts', 'ascii') ??
    foldAttribute(sources, 'rFonts', 'hAnsi') ??
    foldAttribute(sources, 'rFonts', 'eastAsia');
  if (font !== undefined) {
    const family = wordCssFontFamily(font);
    if (family) rules.push(`font-family:${family}`);
  }
  const sz = parseIntValue(foldAttribute(sources, 'sz', 'val'));
  if (sz !== null && sz > 0) rules.push(`font-size:${Math.round((sz / 2) * 100) / 100}pt`);
  if (runToggleOn(layers, 'b')) rules.push('font-weight:bold');
  if (runToggleOn(layers, 'i')) rules.push('font-style:italic');

  const decorations: string[] = [];
  const underline = lastProperty(sources, 'u');
  const underlineOn = underline !== null && wmlVal(underline) !== 'none';
  if (underlineOn) decorations.push('underline');
  const doubleStrike = runToggleOn(layers, 'dstrike');
  if (runToggleOn(layers, 'strike') || doubleStrike) decorations.push('line-through');
  if (decorations.length > 0) rules.push(`text-decoration:${decorations.join(' ')}`);
  // A `w:u w:val="none"` must not emit decoration styling, and the double-strike
  // marker only travels when no underline claims text-decoration-style.
  if (underlineOn) rules.push(...wordUnderlineCss(underline));
  if (doubleStrike && !underlineOn) rules.push('text-decoration-style:double');

  const color = cssHexColor(foldAttribute(sources, 'color', 'val'));
  if (color) rules.push(`color:${color}`);
  const spacing = parseIntValue(foldAttribute(sources, 'spacing', 'val'));
  if (spacing !== null) rules.push(`letter-spacing:${Math.round((spacing / 20) * 100) / 100}pt`);

  // Highlight wins over shading when both are present.
  const highlightVal = wmlVal(lastProperty(sources, 'highlight'));
  const highlight =
    highlightVal !== undefined && Object.hasOwn(WORD_HIGHLIGHT_COLORS, highlightVal)
      ? WORD_HIGHLIGHT_COLORS[highlightVal]
      : undefined;
  const shdFill = cssHexColor(foldAttribute(sources, 'shd', 'fill'));
  if (highlight) {
    // The mso declaration lets a reader reconstruct w:highlight instead of shading.
    rules.push(`background-color:${highlight}`, `mso-highlight:${highlightVal}`);
  } else if (shdFill) {
    rules.push(`background-color:${shdFill}`);
  }

  if (runToggleOn(layers, 'caps')) rules.push('text-transform:uppercase');
  if (runToggleOn(layers, 'smallCaps')) rules.push('font-variant:small-caps');

  const vertAlignVal = wmlVal(lastProperty(sources, 'vertAlign'));
  const vertAlign =
    vertAlignVal === 'superscript' || vertAlignVal === 'subscript' ? vertAlignVal : null;
  const lang = clipboardLanguageTag(
    foldAttribute(sources, 'lang', 'val') ??
      foldAttribute(sources, 'lang', 'bidi') ??
      foldAttribute(sources, 'lang', 'eastAsia')
  );

  return { css: rules.join(';'), vanish: false, vertAlign, lang, rtl: toggleOn(sources, 'rtl') };
}

function paragraphCssOf(sources: readonly OoxmlElement[], omitLeftMargin: boolean): string {
  const rules: string[] = [];
  const jc = wmlVal(lastProperty(sources, 'jc'));
  const align =
    jc !== undefined && Object.hasOwn(WORD_JC_TO_TEXT_ALIGN, jc)
      ? WORD_JC_TO_TEXT_ALIGN[jc]
      : undefined;
  if (align) rules.push(`text-align:${align}`);

  const before = parseIntValue(foldAttribute(sources, 'spacing', 'before'));
  if (before !== null && before >= 0) rules.push(`margin-top:${ptFromTwips(before)}`);
  const after = parseIntValue(foldAttribute(sources, 'spacing', 'after'));
  if (after !== null && after >= 0) rules.push(`margin-bottom:${ptFromTwips(after)}`);
  const line = parseIntValue(foldAttribute(sources, 'spacing', 'line'));
  const lineRule = foldAttribute(sources, 'spacing', 'lineRule');
  rules.push(...wordLineSpacingCss(line, lineRule));

  // Fold w:ind per SOURCE, like layout/style-cascade.ts: hanging/firstLine are one
  // mutually exclusive pair per statement, so a direct `w:firstLine="0"` cancels a
  // style's hanging instead of coexisting with it.
  let left: number | null = null;
  let right: number | null = null;
  let hanging: number | null = null;
  let firstLine: number | null = null;
  for (const source of sources) {
    const ind = wmlChild(source, 'ind');
    if (!ind) continue;
    const leftValue = parseIntValue(
      attrOf(ind, 'left', WML_NAMESPACE_URI) ?? attrOf(ind, 'start', WML_NAMESPACE_URI)
    );
    if (leftValue !== null) left = leftValue;
    const rightValue = parseIntValue(
      attrOf(ind, 'right', WML_NAMESPACE_URI) ?? attrOf(ind, 'end', WML_NAMESPACE_URI)
    );
    if (rightValue !== null) right = rightValue;
    const hangingValue = parseIntValue(attrOf(ind, 'hanging', WML_NAMESPACE_URI));
    const firstLineValue = parseIntValue(attrOf(ind, 'firstLine', WML_NAMESPACE_URI));
    if (hangingValue !== null) {
      hanging = hangingValue;
      firstLine = null;
    } else if (firstLineValue !== null) {
      firstLine = firstLineValue;
      hanging = null;
    }
  }
  if (!omitLeftMargin && left !== null) rules.push(`margin-left:${ptFromTwips(left)}`);
  if (right !== null) rules.push(`margin-right:${ptFromTwips(right)}`);
  if (hanging !== null && hanging !== 0) rules.push(`text-indent:${ptFromTwips(-hanging)}`);
  else if (firstLine !== null && firstLine !== 0)
    rules.push(`text-indent:${ptFromTwips(firstLine)}`);

  const tabs = lastProperty(sources, 'tabs');
  if (tabs) {
    const values: string[] = [];
    for (const child of tabs.children) {
      if (!isElement(child) || child.localName !== 'tab') continue;
      const val = wmlVal(child);
      const pos = parseIntValue(attributeValueOf(child, 'pos', WML_NAMESPACE_URI));
      if (
        pos === null ||
        pos < 0 ||
        (val !== 'left' &&
          val !== 'center' &&
          val !== 'right' &&
          val !== 'decimal' &&
          val !== 'bar')
      ) {
        continue;
      }
      const leader = wmlVal(child, 'leader');
      const cssLeader =
        leader === 'dot'
          ? 'dotted'
          : leader === 'hyphen'
            ? 'dashed'
            : leader === 'underscore'
              ? 'lined'
              : '';
      values.push(`${val}${cssLeader ? ` ${cssLeader}` : ''} ${ptFromTwips(pos)}`);
    }
    if (values.length > 0) rules.push(`tab-stops:${values.join(' ')}`);
  }

  if (toggleOn(sources, 'pageBreakBefore')) rules.push('page-break-before:always');
  if (toggleOn(sources, 'keepNext')) rules.push('page-break-after:avoid');
  if (toggleOn(sources, 'keepLines')) rules.push('page-break-inside:avoid');
  if (toggleOn(sources, 'widowControl')) rules.push('widows:2', 'orphans:2');

  const shading = cssHexColor(foldAttribute(sources, 'shd', 'fill'));
  if (shading) rules.push(`background-color:${shading}`);
  const paragraphBorders = lastProperty(sources, 'pBdr');
  if (paragraphBorders) {
    for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
      const css = wordBorderCss(wmlChild(paragraphBorders, edge));
      if (css) rules.push(`border-${edge}:${css}`, `mso-border-${edge}-alt:${css}`);
    }
  }

  return rules.join(';');
}

interface RenderContext {
  readonly pkg: OoxmlPackage;
  readonly styles: StyleIndex;
  readonly numbering: HtmlNumberingIndex;
  readonly docRels: readonly RelationshipRecord[];
  readonly maxImageBytes: number;
  readonly maxTotalImageBytes: number;
  /** Running total of inlined media bytes — one shared object, so per-note context
   *  forks (`{ ...ctx }`) keep charging the same whole-document budget. */
  readonly imageBudget: { used: number };
  /** `data:` URI per media part — the budget charges each part ONCE, and repeated
   *  references reuse the encoding. */
  readonly imageDataUris: Map<string, string | null>;
  /** Display ordinal per note id, assigned in body reference order. */
  readonly noteOrdinals: Record<'footnote' | 'endnote', Map<number, number>>;
  readonly noteBody: WordNoteBodyContext | null;
}

function noteOrdinalOf(ctx: RenderContext, kind: 'footnote' | 'endnote', id: number): number {
  const map = ctx.noteOrdinals[kind];
  const existing = map.get(id);
  if (existing !== undefined) return existing;
  const ordinal = map.size + 1;
  map.set(id, ordinal);
  return ordinal;
}

/** Complex-field state, one per paragraph. Runs render only when every open field is past
 *  its separator (the cached result); instruction and fldChar runs emit nothing. */
interface FieldState {
  readonly stack: Array<'instr' | 'result'>;
}

const LIST_FMT_TO_CSS: Readonly<Record<string, string>> = {
  decimal: 'decimal',
  lowerLetter: 'lower-alpha',
  upperLetter: 'upper-alpha',
  lowerRoman: 'lower-roman',
  upperRoman: 'upper-roman',
};

interface ListPlacement {
  readonly numId: string;
  readonly abstractId: string;
  readonly level: number;
  readonly fmt: string;
  readonly start: number;
}

/** The declared format and start of one level of a numbering definition. */
function listLevelInfo(
  ctx: RenderContext,
  numId: string,
  abstractId: string,
  level: number
): { readonly fmt: string; readonly start: number } {
  const fmt = ctx.numbering.levelFormats.get(abstractId)?.get(String(level)) ?? 'decimal';
  const start =
    ctx.numbering.startOverrides.get(`${numId}:${level}`) ??
    ctx.numbering.levelStarts.get(abstractId)?.get(String(level)) ??
    1;
  return { fmt, start };
}

function listPlacementOf(
  ctx: RenderContext,
  sources: readonly OoxmlElement[]
): ListPlacement | null {
  let numId: string | undefined;
  let ilvl: string | undefined;
  for (const source of sources) {
    const numPr = wmlChild(source, 'numPr');
    if (!numPr) continue;
    const id = wmlVal(wmlChild(numPr, 'numId'));
    if (id !== undefined) numId = id;
    const level = wmlVal(wmlChild(numPr, 'ilvl'));
    if (level !== undefined) ilvl = level;
  }
  if (numId === undefined || numId === '0') return null;
  let abstractId = ctx.numbering.numToAbstract.get(numId);
  if (abstractId === undefined) return null;
  // A level-less abstractNum can delegate through w:numStyleLink: the linked
  // numbering STYLE names the numId whose abstract holds the real levels.
  if ((ctx.numbering.levelFormats.get(abstractId)?.size ?? 0) === 0) {
    const linkedStyle = ctx.numbering.styleLinks.get(abstractId);
    const style = linkedStyle === undefined ? undefined : ctx.styles.byId.get(linkedStyle);
    const linkedNumId = wmlVal(
      wmlChild(wmlChild(wmlChild(style ?? null, 'pPr'), 'numPr'), 'numId')
    );
    const resolved =
      linkedNumId === undefined ? undefined : ctx.numbering.numToAbstract.get(linkedNumId);
    if (resolved !== undefined) abstractId = resolved;
  }
  const level = Math.min(Math.max(parseIntValue(ilvl) ?? 0, 0), 8);
  const info = listLevelInfo(ctx, numId, abstractId, level);
  return { numId, abstractId, level, fmt: info.fmt, start: info.start };
}

function hasChildOfKind(run: OoxmlElement, kind: string): boolean {
  return run.children.some((child) => child.kind === kind);
}

function renderDrawing(ctx: RenderContext, drawing: OoxmlElement): string {
  // Kind-independent walk: a demoted-to-generic drawing still names its parts. Anchored
  // pictures render like inline ones — HTML has no float-anchor model worth emulating,
  // but the image itself must not vanish from the interop flavour.
  const inline =
    findDescendant(drawing, 'inline', WP_NAMESPACE_URI) ??
    findDescendant(drawing, 'anchor', WP_NAMESPACE_URI);
  if (!inline) return '';
  const blip = findDescendant(inline, 'blip', DRAWINGML_MAIN_NAMESPACE_URI);
  if (!blip) return '';
  const relId = attributeValueOf(blip, 'embed', RELATIONSHIPS_NAMESPACE_URI);
  if (!relId) return '';
  const record = ctx.docRels.find((r) => r.id === relId && r.targetMode !== 'External');
  if (!record) return '';
  const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
  if (!resolved.ok) return '';
  const bytes = ctx.pkg.partBytes.get(resolved.partName);
  if (!bytes) return '';

  const dot = resolved.partName.lastIndexOf('.');
  const extension = dot === -1 ? '' : resolved.partName.slice(dot + 1).toLowerCase();
  const mime =
    extension === 'png'
      ? 'image/png'
      : extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : extension === 'gif'
          ? 'image/gif'
          : null;
  if (!mime) return '';
  // Encode and charge each media part ONCE; later references reuse the data URI.
  let dataUri = ctx.imageDataUris.get(resolved.partName);
  if (dataUri === undefined) {
    if (
      bytes.byteLength > ctx.maxImageBytes ||
      ctx.imageBudget.used + bytes.byteLength > ctx.maxTotalImageBytes
    ) {
      dataUri = null;
    } else {
      ctx.imageBudget.used += bytes.byteLength;
      dataUri = `data:${mime};base64,${clipboardBase64Of(bytes)}`;
    }
    ctx.imageDataUris.set(resolved.partName, dataUri);
  }
  if (dataUri === null) return '';

  const extent = findDescendant(inline, 'extent', WP_NAMESPACE_URI);
  const cx = extent ? parseIntValue(attributeValueOf(extent, 'cx', '')) : null;
  const cy = extent ? parseIntValue(attributeValueOf(extent, 'cy', '')) : null;
  // The pt CSS extents are unit-explicit, so a reader parses them the same way in
  // both its Word and plain conventions; the px attributes serve plain receivers.
  const ptOf = (emu: number): number => Math.round((emu / 12_700) * 100) / 100;
  const size =
    cx !== null && cy !== null && cx > 0 && cy > 0
      ? ` width="${Math.round(cx / EMU_PER_PX)}" height="${Math.round(cy / EMU_PER_PX)}"` +
        ` style="width:${ptOf(cx)}pt;height:${ptOf(cy)}pt"`
      : '';
  return `<img src="${dataUri}"${size}>`;
}

function renderRun(
  ctx: RenderContext,
  run: OoxmlElement,
  paragraphPPr: OoxmlElement | null,
  fields: FieldState
): string {
  // Field machinery first: fldChar runs drive the state and never render themselves.
  if (hasChildOfKind(run, 'fldChar')) {
    for (const child of run.children) {
      if (child.kind !== 'fldChar') continue;
      const type = attributeValueOf(child, 'fldCharType', WML_NAMESPACE_URI);
      if (type === 'begin') fields.stack.push('instr');
      else if (type === 'separate' && fields.stack.length > 0) {
        fields.stack[fields.stack.length - 1] = 'result';
      } else if (type === 'end') fields.stack.pop();
    }
    return '';
  }
  if (hasChildOfKind(run, 'instrText')) return '';
  if (fields.stack.some((mode) => mode === 'instr')) return '';

  const rPr = run.children.find((child) => child.kind === 'runProperties');
  const layers = runPropertyLayers(ctx.styles, paragraphPPr, rPr && isElement(rPr) ? rPr : null);
  const style = runCssOf(layers);
  if (style.vanish) return '';

  let inner = '';
  for (const child of run.children) {
    if (!isElement(child)) continue;
    const positionalTab = wordPositionalTabHtml(child);
    if (positionalTab !== '') {
      inner += positionalTab;
      continue;
    }
    const noteReference = wordNoteReferenceHtml(child, ctx.noteBody, (kind, id) =>
      noteOrdinalOf(ctx, kind, id)
    );
    if (noteReference !== '') {
      inner += noteReference;
      continue;
    }
    switch (child.kind) {
      case 'text':
        inner += escapeHtml(textUnder(child));
        break;
      case 'tab':
        inner += '<span style="white-space:pre;mso-tab-count:1">\t</span>';
        break;
      case 'hardBreak': {
        const type = attributeValueOf(child, 'type', WML_NAMESPACE_URI);
        inner += type === 'page' ? '<br style="page-break-before:always">' : '<br>';
        break;
      }
      case 'bookmarkStart': {
        const name = clipboardBookmarkName(attributeValueOf(child, 'name', WML_NAMESPACE_URI));
        if (name !== null) inner += `<a id="${escapeAttr(name)}"></a>`;
        break;
      }
      case 'drawing':
        inner += renderDrawing(ctx, child);
        break;
      // deletedText only appears under deletions; noteReference has no HTML mapping in v1.
      default:
        break;
    }
  }
  if (inner === '') return '';
  if (style.vertAlign === 'superscript') inner = `<sup>${inner}</sup>`;
  else if (style.vertAlign === 'subscript') inner = `<sub>${inner}</sub>`;
  const attributes =
    `${style.lang === null ? '' : ` lang="${style.lang}"`}` +
    `${style.rtl ? ' dir="rtl"' : ''}` +
    `${style.css === '' ? '' : ` style="${escapeAttr(style.css)}"`}`;
  return attributes === '' ? inner : `<span${attributes}>${inner}</span>`;
}

function renderInline(
  ctx: RenderContext,
  children: readonly OoxmlNode[],
  paragraphPPr: OoxmlElement | null,
  fields: FieldState
): string {
  let out = '';
  for (const child of children) {
    if (!isElement(child)) continue;
    switch (child.kind) {
      case 'run':
        out += renderRun(ctx, child, paragraphPPr, fields);
        break;
      case 'hyperlink': {
        const inner = renderInline(ctx, child.children, paragraphPPr, fields);
        if (inner === '') break;
        const relId = attributeValueOf(child, 'id', RELATIONSHIPS_NAMESPACE_URI);
        const record = relId
          ? ctx.docRels.find((r) => r.id === relId && r.type === `${R_NS}/hyperlink`)
          : undefined;
        // An internal-mode rel target is a part path, not a URL — only its fragment
        // form (a same-document anchor) survives into the interop flavour.
        const rawTarget =
          record === undefined
            ? undefined
            : record.targetMode === 'External' || record.rawTarget.startsWith('#')
              ? record.rawTarget
              : undefined;
        const target = clipboardHyperlinkTarget(
          rawTarget,
          attributeValueOf(child, 'anchor', WML_NAMESPACE_URI)
        );
        out += target !== null ? `<a href="${escapeAttr(target)}">${inner}</a>` : inner;
        break;
      }
      case 'bookmarkStart': {
        const name = clipboardBookmarkName(attributeValueOf(child, 'name', WML_NAMESPACE_URI));
        if (name !== null) out += `<a id="${escapeAttr(name)}"></a>`;
        break;
      }
      case 'fldSimple':
        // The cached result runs are the visible value.
        out += renderInline(ctx, child.children, paragraphPPr, fields);
        break;
      case 'contentControl': {
        const content = child.children.find((inner) => inner.kind === 'contentControlContent');
        if (content && isElement(content)) {
          out += renderInline(ctx, content.children, paragraphPPr, fields);
        }
        break;
      }
      case 'revisionInsert':
      case 'revisionMoveTo':
        out += renderInline(ctx, child.children, paragraphPPr, fields);
        break;
      // Deleted and moved-away content never travels to external apps.
      case 'revisionDelete':
      case 'revisionMoveFrom':
        break;
      case 'generic':
        out += renderInline(ctx, child.children, paragraphPPr, fields);
        break;
      default:
        break;
    }
  }
  return out;
}

function headingLevelOf(
  ctx: RenderContext,
  ownPPr: OoxmlElement | null,
  sources: readonly OoxmlElement[]
): number | null {
  const styleId = wmlVal(wmlChild(ownPPr, 'pStyle'));
  const chain = styleChain(ctx.styles, styleId);
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const id = attributeValueOf(chain[index]!, 'styleId', WML_NAMESPACE_URI);
    const match = id ? /^Heading([1-6])$/.exec(id) : null;
    if (match) return Number(match[1]);
  }
  // An outline level promotes to <h1>-<h6> only without a named style: a custom
  // style that sets w:outlineLvl for the TOC must not round-trip into HeadingN.
  if (styleId === undefined) {
    const outline = parseIntValue(wmlVal(lastProperty(sources, 'outlineLvl')));
    if (outline !== null && outline >= 0 && outline <= 5) return outline + 1;
  }
  return null;
}

function paragraphClassOf(ctx: RenderContext, ownPPr: OoxmlElement | null): string | null {
  const chain = styleChain(ctx.styles, wmlVal(wmlChild(ownPPr, 'pStyle')));
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const found = wordParagraphClassOf(
      attributeValueOf(chain[index]!, 'styleId', WML_NAMESPACE_URI)
    );
    if (found !== null) return found;
  }
  return null;
}

function renderParagraph(
  ctx: RenderContext,
  paragraph: OoxmlElement,
  options: { readonly asListItem: boolean },
  // The field state spans paragraphs: a complex field's instruction region can
  // cross a paragraph mark, and its content must stay out of the flavour.
  fields: FieldState
): string {
  const pPrNode = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const pPr = pPrNode && isElement(pPrNode) ? pPrNode : null;
  const sources = paragraphPropertySources(ctx.styles, pPr);
  const css = paragraphCssOf(sources, options.asListItem);
  const inner = renderInline(ctx, paragraph.children, pPr, fields);
  const styleAttr = css === '' ? '' : ` style="${escapeAttr(css)}"`;
  const dirAttr = toggleOn(sources, 'bidi') ? ' dir="rtl"' : '';
  const wordClass = paragraphClassOf(ctx, pPr);
  const classAttr = wordClass === null ? '' : ` class="${wordClass}"`;

  if (options.asListItem) return `<li${classAttr}${dirAttr}${styleAttr}>${inner}</li>`;
  const heading = headingLevelOf(ctx, pPr, sources);
  const tag = heading === null ? 'p' : `h${heading}`;
  // The `Heading<N>` class is the marker the read lane maps back to the style in
  // every dialect, so a heading survives when only text/html crosses the trip.
  const headingAttr = heading === null ? classAttr : ` class="Heading${heading}"`;
  return `<${tag}${headingAttr}${dirAttr}${styleAttr}>${inner}</${tag}>`;
}

interface CellPlacement {
  readonly cell: OoxmlElement;
  readonly startColumn: number;
  readonly span: number;
  readonly vMerge: 'restart' | 'continue' | null;
}

/** A typed cell, or a `w:tc` the canonical tree demoted to generic — both occupy a column. */
function isRowCell(child: OoxmlElement): boolean {
  if (child.kind === 'tableCell') return true;
  return child.localName === 'tc' && child.namespaceUri === WML_NAMESPACE_URI;
}

function cellPlacementsOf(rows: readonly OoxmlElement[]): CellPlacement[][] {
  return rows.map((row) => {
    const placements: CellPlacement[] = [];
    let column = 0;
    for (const child of row.children) {
      if (!isElement(child) || !isRowCell(child)) continue;
      const tcPr = wmlChild(child, 'tcPr');
      const span = Math.min(
        Math.max(parseIntValue(wmlVal(wmlChild(tcPr, 'gridSpan'))) ?? 1, 1),
        63
      );
      const vMergeNode = wmlChild(tcPr, 'vMerge');
      const vMerge =
        vMergeNode === null ? null : wmlVal(vMergeNode) === 'restart' ? 'restart' : 'continue';
      placements.push({ cell: child, startColumn: column, span, vMerge });
      column += span;
    }
    return placements;
  });
}

function renderTable(ctx: RenderContext, table: OoxmlElement): string {
  const tblPr = table.children.find((child) => child.kind === 'tableProperties');
  const ownTblPr = tblPr && isElement(tblPr) ? tblPr : null;
  let tblBorders: OoxmlElement | null = null;
  for (const style of styleChain(ctx.styles, wmlVal(wmlChild(ownTblPr, 'tblStyle')))) {
    const styleBorders = wmlChild(wmlChild(style, 'tblPr'), 'tblBorders');
    if (styleBorders) tblBorders = styleBorders;
  }
  const ownBorders = wmlChild(ownTblPr, 'tblBorders');
  if (ownBorders) tblBorders = ownBorders;

  const rows: OoxmlElement[] = [];
  for (const child of table.children) {
    // A typed row, or a `w:tr` the canonical tree demoted to generic — the same
    // tolerance the cell walk applies via isRowCell.
    if (
      isElement(child) &&
      (child.kind === 'tableRow' ||
        (child.localName === 'tr' && child.namespaceUri === WML_NAMESPACE_URI))
    ) {
      rows.push(child);
    }
  }
  const placements = cellPlacementsOf(rows);

  const tableRules = ['border-collapse:collapse'];
  const tableWidth = wmlChild(ownTblPr, 'tblW');
  const width = parseIntValue(attrOf(tableWidth, 'w', WML_NAMESPACE_URI));
  if (width !== null && width > 0 && attrOf(tableWidth, 'type', WML_NAMESPACE_URI) === 'dxa') {
    tableRules.push(`width:${ptFromTwips(width)}`);
  }
  const tableJc = wmlVal(wmlChild(ownTblPr, 'jc'));
  if (tableJc === 'center') tableRules.push('margin-left:auto', 'margin-right:auto');
  else if (tableJc === 'right') tableRules.push('margin-left:auto', 'margin-right:0');
  for (const [xmlName, cssName] of [
    ['insideH', 'insideh'],
    ['insideV', 'insidev'],
  ] as const) {
    const border = wordBorderCss(wmlChild(tblBorders, xmlName));
    if (border) tableRules.push(`mso-border-${cssName}-alt:${border}`);
  }
  let out = `<table style="${tableRules.join(';')}">`;
  placements.forEach((rowCells, rowIndex) => {
    const height = wmlChild(wmlChild(rows[rowIndex] ?? null, 'trPr'), 'trHeight');
    const heightValue = parseIntValue(attrOf(height, 'val', WML_NAMESPACE_URI));
    const rowCss = wordTableRowCss(heightValue, attrOf(height, 'hRule', WML_NAMESPACE_URI));
    const rowStyle = rowCss === '' ? '' : ` style="${rowCss}"`;
    out += `<tr${rowStyle}>`;
    for (const [cellIndex, placement] of rowCells.entries()) {
      if (placement.vMerge === 'continue') continue;
      let rowSpan = 1;
      if (placement.vMerge === 'restart') {
        for (let below = rowIndex + 1; below < placements.length; below += 1) {
          const continuation = placements[below]!.find(
            (candidate) =>
              candidate.startColumn === placement.startColumn && candidate.vMerge === 'continue'
          );
          if (!continuation) break;
          rowSpan += 1;
        }
      }
      const tcPr = wmlChild(placement.cell, 'tcPr');
      const css = wordTableCellCss(
        tcPr,
        tblBorders,
        rowIndex,
        placements.length,
        rowSpan,
        cellIndex,
        rowCells.length
      );
      const attrs =
        (placement.span > 1 ? ` colspan="${placement.span}"` : '') +
        (rowSpan > 1 ? ` rowspan="${rowSpan}"` : '') +
        (css === '' ? '' : ` style="${escapeAttr(css)}"`);
      out += `<td${attrs}>${renderBlocks(ctx, placement.cell.children)}</td>`;
    }
    out += '</tr>';
  });
  return `${out}</table>`;
}

interface OpenList {
  readonly tag: 'ol' | 'ul';
  readonly numId: string;
}

function renderBlocks(ctx: RenderContext, children: readonly OoxmlNode[]): string {
  let out = '';
  const openLists: OpenList[] = [];
  /** Items already emitted per `numId:level`, so a reopened list resumes numbering. */
  const listProgress = new Map<string, number>();
  const fields: FieldState = { stack: [] };

  const closeTopList = (): void => {
    const top = openLists.pop();
    if (top) out += `</${top.tag}>`;
  };
  const closeAllLists = (): void => {
    while (openLists.length > 0) closeTopList();
  };

  // A deeper level opens its nested list as a direct child of the enclosing list — the
  // shape every word-processor receiver accepts — and each `<li>` closes immediately.
  const emitListItem = (paragraph: OoxmlElement, placement: ListPlacement): void => {
    const depth = placement.level + 1;
    while (openLists.length > depth) closeTopList();
    if (openLists.length === depth && openLists[depth - 1]!.numId !== placement.numId) {
      closeTopList();
    }
    while (openLists.length < depth) {
      // Each opened level uses ITS OWN declared format, and a reopened list resumes
      // from the running counter so an interrupting paragraph does not renumber it.
      const levelIndex = openLists.length;
      const info = listLevelInfo(ctx, placement.numId, placement.abstractId, levelIndex);
      const consumed = listProgress.get(`${placement.numId}:${levelIndex}`) ?? 0;
      const startValue = info.start + consumed;
      const tag: 'ol' | 'ul' = info.fmt === 'bullet' ? 'ul' : 'ol';
      const listType =
        tag === 'ol'
          ? Object.hasOwn(LIST_FMT_TO_CSS, info.fmt)
            ? LIST_FMT_TO_CSS[info.fmt]!
            : 'decimal'
          : null;
      const start = tag === 'ol' && startValue !== 1 ? ` start="${startValue}"` : '';
      out += listType
        ? `<${tag}${start} style="list-style-type:${escapeAttr(listType)}">`
        : `<${tag}>`;
      openLists.push({ tag, numId: placement.numId });
    }
    const progressKey = `${placement.numId}:${placement.level}`;
    listProgress.set(progressKey, (listProgress.get(progressKey) ?? 0) + 1);
    // Word restarts sub-levels after each parent item. The level is the digits
    // after the LAST separator, so a file-supplied numId containing ':' cannot
    // confuse the prefix match.
    const prefix = `${placement.numId}:`;
    for (const key of listProgress.keys()) {
      if (!key.startsWith(prefix)) continue;
      const levelPart = key.slice(prefix.length);
      if (/^\d+$/.test(levelPart) && Number(levelPart) > placement.level) {
        listProgress.delete(key);
      }
    }
    out += renderParagraph(ctx, paragraph, { asListItem: true }, fields);
  };

  const visit = (nodes: readonly OoxmlNode[]): void => {
    for (const child of nodes) {
      if (!isElement(child)) continue;
      switch (child.kind) {
        case 'paragraph': {
          const pPrNode = child.children.find((inner) => inner.kind === 'paragraphProperties');
          const pPr = pPrNode && isElement(pPrNode) ? pPrNode : null;
          const placement = listPlacementOf(ctx, paragraphPropertySources(ctx.styles, pPr));
          if (placement) {
            emitListItem(child, placement);
          } else {
            closeAllLists();
            out += renderParagraph(ctx, child, { asListItem: false }, fields);
          }
          break;
        }
        case 'table':
          closeAllLists();
          out += renderTable(ctx, child);
          break;
        case 'contentControl': {
          const content = child.children.find((inner) => inner.kind === 'contentControlContent');
          if (content && isElement(content)) visit(content.children);
          break;
        }
        case 'generic':
          // Unknown wrappers may hide block content; raw markup itself never travels.
          visit(child.children);
          break;
        default:
          break;
      }
    }
  };
  visit(children);
  closeAllLists();
  return out;
}

function renderNoteList(
  ctx: RenderContext,
  kind: 'footnote' | 'endnote',
  root: OoxmlElement | null
): string {
  if (root === null) return '';
  let ownerPart = `/word/${kind}s.xml`;
  for (const [name, part] of ctx.pkg.parts) {
    if (part.root === root) ownerPart = name;
  }
  const noteRels = relationshipsOf(ctx.pkg, ownerPart);
  let notes = '';
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== kind) continue;
    const id = attributeValueOf(child, 'id', WML_NAMESPACE_URI);
    if (id === undefined || !/^[1-9]\d{0,4}$/.test(id)) continue;
    // Same cap as wordNoteReferenceHtml, so no note body ships without its reference.
    const idValue = Number.parseInt(id, 10);
    if (idValue > 32_767) continue;
    const inner = renderBlocks(
      { ...ctx, noteBody: { kind, id: idValue }, docRels: noteRels },
      child.children
    );
    if (inner !== '')
      notes += `<div style="mso-element:${kind}" id="${kind === 'footnote' ? 'ftn' : 'edn'}${id}">${inner}</div>`;
  }
  return notes === '' ? '' : `<div style="mso-element:${kind}-list">${notes}</div>`;
}

/**
 * Interop HTML for the fragment package's document body. Returns '' when the package
 * cannot be read.
 *
 * Returns the block sequence WITHOUT a wrapper element: the caller wraps the result in
 * the single `<div>` that also carries the fragment attribute (design D1), so this
 * writer never emits data attributes of its own.
 */
export function interopHtmlFromFragment(
  fragmentBytes: Uint8Array,
  options?: InteropHtmlOptions
): string {
  const read = readOoxmlPackage(fragmentBytes);
  if (!read.ok) return '';
  return interopHtmlFromFragmentPackage(read.package, options);
}

/**
 * The same writer over an ALREADY-READ fragment package, so a caller that just built or
 * read the package (the copy path) does not pay a second inflate + parse.
 */
export function interopHtmlFromFragmentPackage(
  pkg: OoxmlPackage,
  options?: InteropHtmlOptions
): string {
  const documentPart = pkg.parts.get(pkg.mainDocumentPart);
  if (!documentPart || !isElement(documentPart.root)) return '';
  const body = documentPart.root.children.find((child) => child.kind === 'body');
  if (!body || !isElement(body)) return '';

  const ctx: RenderContext = {
    pkg,
    styles: styleIndexOf(pkg),
    numbering: htmlNumberingIndexOf(relatedPart(pkg, NUMBERING_REL, '/word/numbering.xml')),
    docRels: relationshipsOf(pkg, pkg.mainDocumentPart),
    maxImageBytes: options?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES,
    maxTotalImageBytes: options?.maxTotalImageBytes ?? DEFAULT_MAX_TOTAL_IMAGE_BYTES,
    imageBudget: { used: 0 },
    imageDataUris: new Map(),
    noteOrdinals: { footnote: new Map(), endnote: new Map() },
    noteBody: null,
  };
  return (
    renderBlocks(ctx, body.children) +
    renderNoteList(ctx, 'footnote', relatedPart(pkg, FOOTNOTES_REL, '/word/footnotes.xml')) +
    renderNoteList(ctx, 'endnote', relatedPart(pkg, ENDNOTES_REL, '/word/endnotes.xml'))
  );
}
