// Chart text: run styles resolved through the chart's text property layers, a width estimate
// for automatic layout, and read-only stories for every label.
//
// Chart text inherits in layers: the chart space `c:txPr`, then the element's own `c:txPr`
// (axis, legend, title, data labels), then rich text run properties. Each label lowers to a
// one-paragraph DrawingML text body and through `lowerDrawingTextBody`, so the text box layout
// and both painters set it with the real fonts. The store has no text measurer: automatic
// layout sizes the plot area from an advance-width estimate, and each label is set aligned
// inside a frame wider than the estimate, so a misestimate moves no text off its anchor.

import { isElement } from './drawing-projection-walk.ts';
import { resolveColorNode, type ShapeSchemeColorResolver } from './drawing-shape-color.ts';
import { findDirectChild } from './drawing-shape-readers.ts';
import { lowerDrawingTextBody } from './drawingml-text-lowering.ts';
import type { GroupTextboxProjection } from './group-textbox-projection.ts';
import { schemaAttributeValue } from './ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, readOoxmlPart, type OoxmlElement } from './ooxml-tree.ts';
import { escapeXml, escapeXmlAttribute, isValidXmlText } from './sinks.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const EMU_PER_POINT = 12_700;
const MAX_LABEL_UNITS = 512;
const MAX_FACE_UNITS = 128;

/** Advance widths of the default chart face for U+0020..U+007E, in thousandths of an em. */
const REGULAR_ADVANCES = [
  226, 326, 401, 498, 507, 715, 682, 221, 303, 303, 498, 498, 250, 306, 252, 386, 507, 507, 507,
  507, 507, 507, 507, 507, 507, 507, 268, 268, 498, 498, 498, 463, 894, 579, 544, 533, 615, 488,
  459, 631, 623, 252, 319, 520, 420, 855, 646, 662, 517, 673, 543, 459, 487, 642, 567, 890, 519,
  487, 468, 307, 386, 307, 498, 498, 291, 479, 525, 423, 525, 498, 305, 471, 525, 229, 239, 455,
  229, 799, 525, 527, 525, 525, 349, 391, 335, 525, 452, 715, 433, 453, 395, 314, 460, 314, 498,
];
const BOLD_ADVANCES = [
  226, 326, 438, 498, 507, 729, 705, 233, 312, 312, 498, 498, 258, 306, 267, 430, 507, 507, 507,
  507, 507, 507, 507, 507, 507, 507, 276, 276, 498, 498, 498, 463, 898, 606, 561, 529, 630, 488,
  459, 637, 631, 267, 331, 547, 423, 874, 659, 676, 532, 686, 563, 473, 495, 653, 591, 906, 551,
  520, 478, 325, 430, 325, 498, 498, 300, 494, 537, 418, 537, 503, 316, 474, 537, 246, 255, 480,
  246, 813, 537, 538, 537, 537, 355, 399, 347, 537, 473, 745, 459, 474, 397, 344, 475, 344, 498,
];

/** Line height of the default chart face, as a multiple of the size. */
export const CHART_LINE_HEIGHT = 1.22;

export interface ChartTextStyle {
  readonly sizePt: number;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly colorHex: string;
  /** A theme token (`+mn-lt`) or a face name. */
  readonly latin: string;
  readonly eastAsian: string | null;
  readonly complex: string | null;
}

function flag(element: OoxmlElement, name: string): boolean | null {
  const raw = schemaAttributeValue(element.attributes, name);
  if (raw === '1' || raw === 'true') return true;
  if (raw === '0' || raw === 'false') return false;
  return null;
}

function face(element: OoxmlElement, name: string): string | null {
  const font = findDirectChild(element.children, { namespaceUri: A, localName: name });
  const typeface = font ? schemaAttributeValue(font.attributes, 'typeface') : undefined;
  return typeface && typeface.length <= MAX_FACE_UNITS && isValidXmlText(typeface)
    ? typeface
    : null;
}

/** Apply one run property layer (`a:defRPr` or `a:rPr`) over `base`. */
export function applyRunLayer(
  base: ChartTextStyle,
  layer: OoxmlElement | null,
  resolveSchemeColor?: ShapeSchemeColorResolver
): ChartTextStyle {
  if (!layer) return base;
  const sizeRaw = schemaAttributeValue(layer.attributes, 'sz');
  const size = sizeRaw && /^\d{3,6}$/.test(sizeRaw) ? Number(sizeRaw) / 100 : null;
  const fill = findDirectChild(layer.children, { namespaceUri: A, localName: 'solidFill' });
  const colorNode = fill?.children.find(isElement);
  const color = colorNode ? resolveColorNode(colorNode, resolveSchemeColor) : null;
  const underline = schemaAttributeValue(layer.attributes, 'u');
  return {
    sizePt: size !== null && size >= 1 && size <= 400 ? size : base.sizePt,
    bold: flag(layer, 'b') ?? base.bold,
    italic: flag(layer, 'i') ?? base.italic,
    underline: underline === undefined ? base.underline : underline !== 'none',
    colorHex: color?.hex ?? base.colorHex,
    latin: face(layer, 'latin') ?? base.latin,
    eastAsian: face(layer, 'ea') ?? base.eastAsian,
    complex: face(layer, 'cs') ?? base.complex,
  };
}

/** The first paragraph's `a:defRPr` of a `c:txPr` or `c:rich` body. */
export function bodyDefaultRun(body: OoxmlElement | null): OoxmlElement | null {
  if (!body) return null;
  const paragraph = findDirectChild(body.children, { namespaceUri: A, localName: 'p' });
  const pPr = paragraph
    ? findDirectChild(paragraph.children, { namespaceUri: A, localName: 'pPr' })
    : null;
  return pPr ? findDirectChild(pPr.children, { namespaceUri: A, localName: 'defRPr' }) : null;
}

/**
 * The clockwise turn a `c:txPr`/`c:rich` body asks for, in degrees, or null for automatic
 * (no `rot`, or the `-60000000` sentinel).
 */
export function bodyRotation(body: OoxmlElement | null): number | null {
  const bodyPr = body
    ? findDirectChild(body.children, { namespaceUri: A, localName: 'bodyPr' })
    : null;
  if (!bodyPr) return null;
  const vert = schemaAttributeValue(bodyPr.attributes, 'vert');
  if (vert === 'vert') return 90;
  if (vert === 'vert270') return -90;
  const raw = schemaAttributeValue(bodyPr.attributes, 'rot');
  if (raw === undefined || !/^-?\d{1,9}$/.test(raw)) return null;
  const value = Number(raw);
  if (value === -60_000_000 || Math.abs(value) > 5_400_000) return null;
  return value / 60_000;
}

function advance(code: number, bold: boolean): number {
  if (code >= 0x20 && code <= 0x7e) return (bold ? BOLD_ADVANCES : REGULAR_ADVANCES)[code - 0x20]!;
  if (code >= 0x2e80) return 1000;
  return 560;
}

/** Estimated advance width of `text` in points. */
export function estimateTextWidth(text: string, style: ChartTextStyle): number {
  let total = 0;
  let units = 0;
  for (const char of text) {
    if (++units > MAX_LABEL_UNITS) break;
    total += advance(char.codePointAt(0)!, style.bold);
  }
  return (total / 1000) * style.sizePt;
}

/** Height of one line of `style`, in points. */
export function lineHeight(style: ChartTextStyle): number {
  return style.sizePt * CHART_LINE_HEIGHT;
}

/** One run of label text with its style. */
export interface ChartTextRun {
  readonly text: string;
  readonly style: ChartTextStyle;
}

/** Height of paragraphs of runs: each line as tall as its largest run. */
export function paragraphsHeight(
  paragraphs: readonly (readonly ChartTextRun[])[],
  fallback: ChartTextStyle
): number {
  let total = 0;
  for (const runs of paragraphs) {
    total +=
      runs.length > 0
        ? Math.max(...runs.map((run) => lineHeight(run.style)))
        : lineHeight(fallback);
  }
  return total;
}

/** Estimated width of the widest of `paragraphs`. */
export function paragraphsWidth(paragraphs: readonly (readonly ChartTextRun[])[]): number {
  let widest = 0;
  for (const runs of paragraphs) {
    widest = Math.max(
      widest,
      runs.reduce((sum, run) => sum + estimateTextWidth(run.text, run.style), 0)
    );
  }
  return widest;
}

function runXml(run: ChartTextRun): string {
  const style = run.style;
  const fonts =
    `<a:latin typeface="${escapeXmlAttribute(style.latin)}"/>` +
    (style.eastAsian ? `<a:ea typeface="${escapeXmlAttribute(style.eastAsian)}"/>` : '') +
    (style.complex ? `<a:cs typeface="${escapeXmlAttribute(style.complex)}"/>` : '');
  const text = run.text.length > MAX_LABEL_UNITS ? run.text.slice(0, MAX_LABEL_UNITS) : run.text;
  return (
    `<a:r><a:rPr sz="${Math.round(style.sizePt * 100)}" b="${style.bold ? 1 : 0}" ` +
    `i="${style.italic ? 1 : 0}" u="${style.underline ? 'sng' : 'none'}">` +
    `<a:solidFill><a:srgbClr val="${style.colorHex}"/></a:solidFill>${fonts}</a:rPr>` +
    `<a:t>${escapeXml(text)}</a:t></a:r>`
  );
}

export type ChartTextAlign = 'l' | 'ctr' | 'r';

/** Label frame and text in chart points; the projection converts to EMU. */
export interface ChartLabel {
  /** Paragraphs of runs. */
  readonly paragraphs: readonly (readonly ChartTextRun[])[];
  readonly align: ChartTextAlign;
  /** Frame in chart points, before rotation about its center. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Clockwise turn about the frame center, in degrees. */
  readonly rotation: number;
}

/**
 * A label as a group text box, or null when its text cannot be set. File text reaches the
 * generated markup only through `escapeXml`/`escapeXmlAttribute`.
 */
export function chartLabelTextbox(
  label: ChartLabel,
  id: string,
  partName: string
): GroupTextboxProjection | null {
  const paragraphs: string[] = [];
  for (const runs of label.paragraphs) {
    const usable = runs.filter((run) => run.text !== '' && isValidXmlText(run.text));
    if (usable.length === 0) continue;
    // The paragraph mark takes the size of the text, so it does not raise the line.
    const markSize = Math.round(Math.min(...usable.map((run) => run.style.sizePt)) * 100);
    paragraphs.push(
      `<a:p><a:pPr algn="${label.align}"/>${usable.map(runXml).join('')}` +
        `<a:endParaRPr sz="${markSize}"/></a:p>`
    );
  }
  if (paragraphs.length === 0) return null;
  const xml =
    `<a:txBody xmlns:a="${A}"><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" ` +
    `anchor="ctr"/><a:lstStyle/>${paragraphs.join('')}</a:txBody>`;
  const parsed = readOoxmlPart(xml, { name: `${partName}#${id}`, contentType: 'application/xml' });
  if (!parsed.ok) return null;
  const lowered = lowerDrawingTextBody(parsed.part.root, `${partName}#${id}:story`, {
    fontSlot: null,
    color: null,
  });
  if (lowered === 'no-text' || lowered === 'unsupported') return null;
  const cx = Math.max(1, Math.round(label.width * EMU_PER_POINT));
  const cy = Math.max(1, Math.round(label.height * EMU_PER_POINT));
  const rotation = ((label.rotation % 360) + 360) % 360;
  return Object.freeze({
    memberNodeId: id,
    frameEmu: Object.freeze({
      x: Math.round(label.x * EMU_PER_POINT),
      y: Math.round(label.y * EMU_PER_POINT),
      cx,
      cy,
    }),
    story: Object.freeze({
      contentNodeId: lowered.content.id,
      content: lowered.content,
      insetsEmu: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
      verticalAnchor: 'center' as const,
      autofit: 'none' as const,
      fillHex: null,
      strokeHex: null,
      strokeWidthEmu: 0,
      drawingText: true as const,
    }),
    rotationDegrees: Number.isFinite(rotation) ? rotation : 0,
  });
}
