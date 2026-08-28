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
import { clipboardBookmarkName, clipboardHyperlinkTarget } from './clipboard-html-links.ts';
import { htmlNumberingIndexOf, type HtmlNumberingIndex } from './clipboard-html-write-numbering.ts';
import {
  wordBorderCss,
  wordCssFontFamily,
  wordLineSpacingCss,
  wordNoteReferenceHtml,
  wordParagraphClassOf,
  wordPositionalTabHtml,
  wordTableRowCss,
} from './clipboard-html-word-elements.ts';

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STYLES_REL = `${R_NS}/styles`;
const NUMBERING_REL = `${R_NS}/numbering`;

/** `basedOn` chains are file-supplied; a cycle must not become a loop bound. */
const MAX_STYLE_CHAIN = 16;
const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_IMAGE_BYTES = 8 * 1024 * 1024;
const EMU_PER_PX = 9525;

export interface InteropHtmlOptions {
  /** Per-image data: URI budget, bytes of source media. Default 2 MiB. */
  readonly maxImageBytes?: number;
  /** Total image budget. Default 8 MiB. Images beyond either budget are omitted. */
  readonly maxTotalImageBytes?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const escapeAttr = escapeHtml;

function cssHexColor(raw: string | undefined): string | null {
  if (raw === undefined || raw.toLowerCase() === 'auto') return null;
  return /^[0-9A-Fa-f]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : null;
}

/** Twips → pt, trimmed to two decimals. */
function ptFromTwips(twips: number): string {
  return `${Math.round((twips / 20) * 100) / 100}pt`;
}

function parseIntValue(raw: string | undefined): number | null {
  if (raw === undefined || !/^-?\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function wmlChild(parent: OoxmlNode | null | undefined, localName: string): OoxmlElement | null {
  if (!parent || parent.kind === 'textValue') return null;
  for (const child of parent.children) {
    if (
      isElement(child) &&
      child.localName === localName &&
      child.namespaceUri === WML_NAMESPACE_URI
    ) {
      return child;
    }
  }
  return null;
}

function wmlVal(node: OoxmlElement | null, localName = 'val'): string | undefined {
  return node ? attributeValueOf(node, localName, WML_NAMESPACE_URI) : undefined;
}

function attrOf(
  node: OoxmlElement | null,
  localName: string,
  namespaceUri: string
): string | undefined {
  return node ? attributeValueOf(node, localName, namespaceUri) : undefined;
}

function textUnder(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let out = '';
  for (const child of node.children) out += textUnder(child);
  return out;
}

/** First descendant element with the expanded name, depth-first. */
function findDescendant(
  node: OoxmlNode,
  localName: string,
  namespaceUri: string
): OoxmlElement | null {
  if (node.kind === 'textValue') return null;
  if (node.localName === localName && node.namespaceUri === namespaceUri) return node;
  for (const child of node.children) {
    const found = findDescendant(child, localName, namespaceUri);
    if (found) return found;
  }
  return null;
}

interface StyleIndex {
  readonly byId: ReadonlyMap<string, OoxmlElement>;
  readonly docDefaultsRPr: OoxmlElement | null;
  readonly docDefaultsPPr: OoxmlElement | null;
  readonly defaultParagraphStyleId: string | null;
}

function relatedPart(pkg: OoxmlPackage, relType: string, fallback: string): OoxmlElement | null {
  for (const record of relationshipsOf(pkg, pkg.mainDocumentPart)) {
    if (record.type !== relType || record.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
    if (resolved.ok) {
      const part = pkg.parts.get(resolved.partName);
      if (part && isElement(part.root)) return part.root;
    }
  }
  const part = pkg.parts.get(fallback);
  return part && isElement(part.root) ? part.root : null;
}

function styleIndexOf(pkg: OoxmlPackage): StyleIndex {
  const root = relatedPart(pkg, STYLES_REL, '/word/styles.xml');
  const byId = new Map<string, OoxmlElement>();
  let docDefaultsRPr: OoxmlElement | null = null;
  let docDefaultsPPr: OoxmlElement | null = null;
  let defaultParagraphStyleId: string | null = null;
  if (!root) return { byId, docDefaultsRPr, docDefaultsPPr, defaultParagraphStyleId };
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName === 'docDefaults') {
      docDefaultsRPr = wmlChild(wmlChild(child, 'rPrDefault'), 'rPr');
      docDefaultsPPr = wmlChild(wmlChild(child, 'pPrDefault'), 'pPr');
      continue;
    }
    if (child.localName !== 'style') continue;
    const id = attributeValueOf(child, 'styleId', WML_NAMESPACE_URI);
    if (!id) continue;
    byId.set(id, child);
    const isDefault = attributeValueOf(child, 'default', WML_NAMESPACE_URI);
    const type = attributeValueOf(child, 'type', WML_NAMESPACE_URI);
    if ((isDefault === '1' || isDefault === 'true') && type === 'paragraph') {
      defaultParagraphStyleId = id;
    }
  }
  return { byId, docDefaultsRPr, docDefaultsPPr, defaultParagraphStyleId };
}

/** The `basedOn` chain, base style FIRST, cycle-capped. */
function styleChain(index: StyleIndex, styleId: string | undefined): OoxmlElement[] {
  const chain: OoxmlElement[] = [];
  const seen = new Set<string>();
  let current = styleId;
  while (current && !seen.has(current) && chain.length < MAX_STYLE_CHAIN) {
    seen.add(current);
    const style = index.byId.get(current);
    if (!style) break;
    chain.unshift(style);
    current = wmlVal(wmlChild(style, 'basedOn'));
  }
  return chain;
}

/**
 * Ordered property sources, lowest precedence first: docDefaults, the default paragraph
 * style chain, the paragraph style chain, the run style chain, then direct formatting.
 */
function paragraphPropertySources(index: StyleIndex, ownPPr: OoxmlElement | null): OoxmlElement[] {
  const sources: OoxmlElement[] = [];
  if (index.docDefaultsPPr) sources.push(index.docDefaultsPPr);
  for (const style of styleChain(index, index.defaultParagraphStyleId ?? undefined)) {
    const pPr = wmlChild(style, 'pPr');
    if (pPr) sources.push(pPr);
  }
  for (const style of styleChain(index, wmlVal(wmlChild(ownPPr, 'pStyle')))) {
    const pPr = wmlChild(style, 'pPr');
    if (pPr) sources.push(pPr);
  }
  if (ownPPr) sources.push(ownPPr);
  return sources;
}

function runPropertySources(
  index: StyleIndex,
  paragraphPPr: OoxmlElement | null,
  ownRPr: OoxmlElement | null
): OoxmlElement[] {
  const sources: OoxmlElement[] = [];
  if (index.docDefaultsRPr) sources.push(index.docDefaultsRPr);
  for (const style of styleChain(index, index.defaultParagraphStyleId ?? undefined)) {
    const rPr = wmlChild(style, 'rPr');
    if (rPr) sources.push(rPr);
  }
  for (const style of styleChain(index, wmlVal(wmlChild(paragraphPPr, 'pStyle')))) {
    const rPr = wmlChild(style, 'rPr');
    if (rPr) sources.push(rPr);
  }
  for (const style of styleChain(index, wmlVal(wmlChild(ownRPr, 'rStyle')))) {
    const rPr = wmlChild(style, 'rPr');
    if (rPr) sources.push(rPr);
  }
  if (ownRPr) sources.push(ownRPr);
  return sources;
}

/** The last source carrying the named property child wins. */
function lastProperty(sources: readonly OoxmlElement[], localName: string): OoxmlElement | null {
  let found: OoxmlElement | null = null;
  for (const source of sources) {
    const child = wmlChild(source, localName);
    if (child) found = child;
  }
  return found;
}

/** Fold one attribute across every source carrying the property (per-attribute later-wins). */
function foldAttribute(
  sources: readonly OoxmlElement[],
  propertyName: string,
  attributeName: string
): string | undefined {
  let value: string | undefined;
  for (const source of sources) {
    const child = wmlChild(source, propertyName);
    if (!child) continue;
    const attr = attributeValueOf(child, attributeName, WML_NAMESPACE_URI);
    if (attr !== undefined) value = attr;
  }
  return value;
}

/** Toggle semantics: presence with `w:val` absent is on; "0"/"false"/"none" is off. */
function toggleOn(sources: readonly OoxmlElement[], localName: string): boolean {
  let state = false;
  for (const source of sources) {
    const child = wmlChild(source, localName);
    if (!child) continue;
    const val = wmlVal(child);
    state = !(val === '0' || val === 'false' || val === 'none');
  }
  return state;
}

const HIGHLIGHT_COLORS: Readonly<Record<string, string>> = {
  yellow: 'yellow',
  green: 'green',
  cyan: 'cyan',
  magenta: 'magenta',
  blue: 'blue',
  red: 'red',
  darkBlue: 'darkblue',
  darkCyan: 'darkcyan',
  darkGreen: 'darkgreen',
  darkMagenta: 'darkmagenta',
  darkRed: 'darkred',
  darkYellow: '#808000',
  darkGray: '#a9a9a9',
  lightGray: '#d3d3d3',
  black: 'black',
  white: 'white',
};

const JC_TO_TEXT_ALIGN: Readonly<Record<string, string>> = {
  left: 'left',
  start: 'left',
  center: 'center',
  right: 'right',
  end: 'right',
  both: 'justify',
  distribute: 'justify',
};

interface RunCss {
  readonly css: string;
  readonly vanish: boolean;
  readonly vertAlign: 'superscript' | 'subscript' | null;
}

function runCssOf(sources: readonly OoxmlElement[]): RunCss {
  if (toggleOn(sources, 'vanish')) return { css: '', vanish: true, vertAlign: null };
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
  if (toggleOn(sources, 'b')) rules.push('font-weight:bold');
  if (toggleOn(sources, 'i')) rules.push('font-style:italic');

  const decorations: string[] = [];
  const underline = lastProperty(sources, 'u');
  if (underline && wmlVal(underline) !== 'none') decorations.push('underline');
  if (toggleOn(sources, 'strike')) decorations.push('line-through');
  if (decorations.length > 0) rules.push(`text-decoration:${decorations.join(' ')}`);

  const color = cssHexColor(foldAttribute(sources, 'color', 'val'));
  if (color) rules.push(`color:${color}`);

  // Highlight wins over shading when both are present.
  const highlightVal = wmlVal(lastProperty(sources, 'highlight'));
  const highlight =
    highlightVal !== undefined && Object.hasOwn(HIGHLIGHT_COLORS, highlightVal)
      ? HIGHLIGHT_COLORS[highlightVal]
      : undefined;
  const shdFill = cssHexColor(foldAttribute(sources, 'shd', 'fill'));
  if (highlight) rules.push(`background-color:${highlight}`);
  else if (shdFill) rules.push(`background-color:${shdFill}`);

  if (toggleOn(sources, 'caps')) rules.push('text-transform:uppercase');
  if (toggleOn(sources, 'smallCaps')) rules.push('font-variant:small-caps');

  const vertAlignVal = wmlVal(lastProperty(sources, 'vertAlign'));
  const vertAlign =
    vertAlignVal === 'superscript' || vertAlignVal === 'subscript' ? vertAlignVal : null;

  return { css: rules.join(';'), vanish: false, vertAlign };
}

function paragraphCssOf(sources: readonly OoxmlElement[], omitLeftMargin: boolean): string {
  const rules: string[] = [];
  const jc = wmlVal(lastProperty(sources, 'jc'));
  const align =
    jc !== undefined && Object.hasOwn(JC_TO_TEXT_ALIGN, jc) ? JC_TO_TEXT_ALIGN[jc] : undefined;
  if (align) rules.push(`text-align:${align}`);

  const before = parseIntValue(foldAttribute(sources, 'spacing', 'before'));
  if (before !== null && before >= 0) rules.push(`margin-top:${ptFromTwips(before)}`);
  const after = parseIntValue(foldAttribute(sources, 'spacing', 'after'));
  if (after !== null && after >= 0) rules.push(`margin-bottom:${ptFromTwips(after)}`);
  const line = parseIntValue(foldAttribute(sources, 'spacing', 'line'));
  const lineRule = foldAttribute(sources, 'spacing', 'lineRule');
  rules.push(...wordLineSpacingCss(line, lineRule));

  const left = parseIntValue(
    foldAttribute(sources, 'ind', 'left') ?? foldAttribute(sources, 'ind', 'start')
  );
  if (!omitLeftMargin && left !== null) rules.push(`margin-left:${ptFromTwips(left)}`);
  const right = parseIntValue(
    foldAttribute(sources, 'ind', 'right') ?? foldAttribute(sources, 'ind', 'end')
  );
  if (right !== null) rules.push(`margin-right:${ptFromTwips(right)}`);
  const hanging = parseIntValue(foldAttribute(sources, 'ind', 'hanging'));
  const firstLine = parseIntValue(foldAttribute(sources, 'ind', 'firstLine'));
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
  /** Running total of media bytes already inlined, shared across the whole document. */
  imageBytesUsed: number;
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
  readonly level: number;
  readonly fmt: string;
  readonly start: number;
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
  const abstractId = ctx.numbering.numToAbstract.get(numId);
  if (abstractId === undefined) return null;
  const level = Math.min(Math.max(parseIntValue(ilvl) ?? 0, 0), 8);
  const fmt = ctx.numbering.levelFormats.get(abstractId)?.get(String(level)) ?? 'decimal';
  const start =
    ctx.numbering.startOverrides.get(`${numId}:${level}`) ??
    ctx.numbering.levelStarts.get(abstractId)?.get(String(level)) ??
    1;
  return { numId, level, fmt, start };
}

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

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
  if (bytes.byteLength > ctx.maxImageBytes) return '';
  if (ctx.imageBytesUsed + bytes.byteLength > ctx.maxTotalImageBytes) return '';
  ctx.imageBytesUsed += bytes.byteLength;

  const extent = findDescendant(inline, 'extent', WP_NAMESPACE_URI);
  const cx = extent ? parseIntValue(attributeValueOf(extent, 'cx', '')) : null;
  const cy = extent ? parseIntValue(attributeValueOf(extent, 'cy', '')) : null;
  const size =
    cx !== null && cy !== null && cx > 0 && cy > 0
      ? ` width="${Math.round(cx / EMU_PER_PX)}" height="${Math.round(cy / EMU_PER_PX)}"`
      : '';
  return `<img src="data:${mime};base64,${clipboardBase64Of(bytes)}"${size}>`;
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
  const sources = runPropertySources(ctx.styles, paragraphPPr, rPr && isElement(rPr) ? rPr : null);
  const style = runCssOf(sources);
  if (style.vanish) return '';

  let inner = '';
  for (const child of run.children) {
    if (!isElement(child)) continue;
    const positionalTab = wordPositionalTabHtml(child);
    if (positionalTab !== '') {
      inner += positionalTab;
      continue;
    }
    const noteReference = wordNoteReferenceHtml(child);
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
  return style.css === '' ? inner : `<span style="${escapeAttr(style.css)}">${inner}</span>`;
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
        const target = clipboardHyperlinkTarget(
          record?.rawTarget,
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
  const outline = parseIntValue(wmlVal(lastProperty(sources, 'outlineLvl')));
  if (outline !== null && outline >= 0 && outline <= 5) return outline + 1;
  const chain = styleChain(ctx.styles, wmlVal(wmlChild(ownPPr, 'pStyle')));
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const id = attributeValueOf(chain[index]!, 'styleId', WML_NAMESPACE_URI);
    const match = id ? /^Heading([1-6])$/.exec(id) : null;
    if (match) return Number(match[1]);
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
  options: { readonly asListItem: boolean }
): string {
  const pPrNode = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const pPr = pPrNode && isElement(pPrNode) ? pPrNode : null;
  const sources = paragraphPropertySources(ctx.styles, pPr);
  const css = paragraphCssOf(sources, options.asListItem);
  const fields: FieldState = { stack: [] };
  const inner = renderInline(ctx, paragraph.children, pPr, fields);
  const styleAttr = css === '' ? '' : ` style="${escapeAttr(css)}"`;

  if (options.asListItem) return `<li${styleAttr}>${inner}</li>`;
  const heading = headingLevelOf(ctx, pPr, sources);
  const tag = heading === null ? 'p' : `h${heading}`;
  const wordClass = heading === null ? paragraphClassOf(ctx, pPr) : null;
  const classAttr = wordClass === null ? '' : ` class="${wordClass}"`;
  return `<${tag}${classAttr}${styleAttr}>${inner}</${tag}>`;
}

// --- tables ---

interface CellPlacement {
  readonly cell: OoxmlElement;
  readonly startColumn: number;
  readonly span: number;
  readonly vMerge: 'restart' | 'continue' | null;
}

function cellPlacementsOf(rows: readonly OoxmlElement[]): CellPlacement[][] {
  return rows.map((row) => {
    const placements: CellPlacement[] = [];
    let column = 0;
    for (const child of row.children) {
      if (!isElement(child) || child.kind !== 'tableCell') continue;
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

function cellCss(
  tcPr: OoxmlElement | null,
  tblBorders: OoxmlElement | null,
  rowIndex: number,
  rowCount: number,
  cellIndex: number,
  cellCount: number
): string {
  const rules: string[] = [];
  const tcBorders = wmlChild(tcPr, 'tcBorders');
  const tableEdges = {
    top: rowIndex === 0 ? 'top' : 'insideH',
    bottom: rowIndex === rowCount - 1 ? 'bottom' : 'insideH',
    left: cellIndex === 0 ? 'left' : 'insideV',
    right: cellIndex === cellCount - 1 ? 'right' : 'insideV',
  } as const;
  for (const edge of ['top', 'left', 'bottom', 'right'] as const) {
    const border =
      wordBorderCss(wmlChild(tcBorders, edge)) ??
      wordBorderCss(wmlChild(tblBorders, tableEdges[edge]));
    if (border) rules.push(`border-${edge}:${border}`);
  }
  const fill = cssHexColor(attrOf(wmlChild(tcPr, 'shd'), 'fill', WML_NAMESPACE_URI));
  if (fill) rules.push(`background-color:${fill}`);
  const vAlign = wmlVal(wmlChild(tcPr, 'vAlign'));
  if (vAlign === 'center') rules.push('vertical-align:middle');
  else if (vAlign === 'bottom') rules.push('vertical-align:bottom');
  else if (vAlign === 'top') rules.push('vertical-align:top');
  const tcW = wmlChild(tcPr, 'tcW');
  const widthType = attrOf(tcW, 'type', WML_NAMESPACE_URI);
  const width = parseIntValue(attrOf(tcW, 'w', WML_NAMESPACE_URI));
  if (width !== null && width > 0 && (widthType === undefined || widthType === 'dxa')) {
    rules.push(`width:${ptFromTwips(width)}`);
  }
  const margins = wmlChild(tcPr, 'tcMar');
  for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
    const margin = wmlChild(margins, edge);
    const value = parseIntValue(attrOf(margin, 'w', WML_NAMESPACE_URI));
    if (value !== null && value >= 0 && attrOf(margin, 'type', WML_NAMESPACE_URI) === 'dxa') {
      rules.push(`padding-${edge}:${ptFromTwips(value)}`);
    }
  }
  return rules.join(';');
}

function renderTable(ctx: RenderContext, table: OoxmlElement): string {
  const tblPr = table.children.find((child) => child.kind === 'tableProperties');
  const ownTblPr = tblPr && isElement(tblPr) ? tblPr : null;
  // Table-level borders: the style chain's tblBorders, overridden by the table's own.
  let tblBorders: OoxmlElement | null = null;
  for (const style of styleChain(ctx.styles, wmlVal(wmlChild(ownTblPr, 'tblStyle')))) {
    const styleBorders = wmlChild(wmlChild(style, 'tblPr'), 'tblBorders');
    if (styleBorders) tblBorders = styleBorders;
  }
  const ownBorders = wmlChild(ownTblPr, 'tblBorders');
  if (ownBorders) tblBorders = ownBorders;

  const rows: OoxmlElement[] = [];
  for (const child of table.children) {
    if (isElement(child) && child.kind === 'tableRow') rows.push(child);
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
      // A vMerge continuation emits nothing; the restart above spans it.
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
      const css = cellCss(
        tcPr,
        tblBorders,
        rowIndex,
        placements.length,
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
      const tag: 'ol' | 'ul' = placement.fmt === 'bullet' ? 'ul' : 'ol';
      const listType =
        tag === 'ol'
          ? Object.hasOwn(LIST_FMT_TO_CSS, placement.fmt)
            ? LIST_FMT_TO_CSS[placement.fmt]!
            : 'decimal'
          : null;
      const start = tag === 'ol' && placement.start !== 1 ? ` start="${placement.start}"` : '';
      out += listType
        ? `<${tag}${start} style="list-style-type:${escapeAttr(listType)}">`
        : `<${tag}>`;
      openLists.push({ tag, numId: placement.numId });
    }
    out += renderParagraph(ctx, paragraph, { asListItem: true });
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
            out += renderParagraph(ctx, child, { asListItem: false });
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

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

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
    imageBytesUsed: 0,
  };
  return renderBlocks(ctx, body.children);
}
