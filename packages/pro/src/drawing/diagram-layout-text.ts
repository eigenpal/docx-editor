/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The text a diagram shape shows and whether it fits.
//
// A `tx` node shows the content points its presentation point is linked to (`presOf`).
// Paragraphs at the node's own level use the primary font size; deeper ones (children
// shown as bullets) use the secondary size. Fitting wraps words greedily in the text
// rectangle less the margins and stacks the lines at 90% line spacing.

import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  evaluateGeometry,
  isElement,
  presetGeometryDefinition,
  type OoxmlElement,
} from '@docx-editor.dev/core/store';
import { dgmChild, type DiagramModel } from './diagram-layout-model.ts';
import type { DiagramTextMeasurer } from './diagram-layout-metrics.ts';
import {
  EMU_PER_POINT,
  type Box,
  type LayoutSolution,
  type NodeState,
} from './diagram-layout-solve.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
/** Paragraphs one shape may show. */
const MAX_SHAPE_PARAGRAPHS = 256;
/** Line spacing and space after for the node's own text and for child text. */
export const PARENT_LINE_SPACING = 0.9;
export const PARENT_SPACE_AFTER = 0.35;
export const CHILD_SPACE_AFTER = 0.15;
/**
 * Space after a paragraph, as a share of its line: the text algorithm's `lnSpAfParP` or
 * `lnSpAfChP` (percent) for the node's own or child text, else the gallery default.
 */
export function spaceAfter(state: NodeState, level: number): number {
  const raw = state.node.algorithm.params.get(level > 0 ? 'lnSpAfChP' : 'lnSpAfParP');
  const percent = raw !== undefined && /^\d{1,3}(\.\d+)?$/.test(raw) ? Number(raw) : NaN;
  if (Number.isFinite(percent) && percent <= 500) return percent / 100;
  return level > 0 ? CHILD_SPACE_AFTER : PARENT_SPACE_AFTER;
}

/** Child text size relative to the primary size when no secondary size is set. */
export const SECONDARY_FONT_SCALE = 0.78;
/** A text margin no constraint sets, relative to the primary size. */
export const DEFAULT_MARGIN_SCALE = 0.56;

export interface DiagramParagraph {
  readonly element: OoxmlElement;
  /** Outline level below the node's own content: 0 for its own text. */
  readonly level: number;
  readonly text: string;
  /** The largest run size the content sets itself, in points; it overrides the solved one. */
  readonly explicitSize: number | null;
}

function* paragraphsOf(point: OoxmlElement | null): Generator<OoxmlElement> {
  if (!point) return;
  for (const node of point.children) {
    if (isElement(node) && node.namespaceUri === A && node.localName === 'p') yield node;
  }
}

function paragraphText(paragraph: OoxmlElement): string {
  let text = '';
  for (const run of paragraph.children) {
    if (!isElement(run) || run.namespaceUri !== A) continue;
    if (run.localName === 'br') {
      text += '\n';
      continue;
    }
    if (run.localName !== 'r' && run.localName !== 'fld') continue;
    for (const t of run.children) {
      if (!isElement(t) || t.namespaceUri !== A || t.localName !== 't') continue;
      for (const value of t.children) if (value.kind === 'textValue') text += value.value;
    }
  }
  return text;
}

/** The largest `sz` a paragraph's runs set (hundredths of a point in the file). */
function explicitRunSize(paragraph: OoxmlElement): number | null {
  let largest: number | null = null;
  for (const run of paragraph.children) {
    if (!isElement(run) || run.namespaceUri !== A || run.localName !== 'r') continue;
    for (const property of run.children) {
      if (!isElement(property) || property.localName !== 'rPr') continue;
      const raw = property.attributes.find((attribute) => attribute.localName === 'sz')?.value;
      const size = raw !== undefined && /^\d{3,6}$/.test(raw) ? Number(raw) / 100 : NaN;
      if (size >= 1 && size <= 4000) largest = Math.max(largest ?? 0, size);
    }
  }
  return largest;
}

function depthOf(model: DiagramModel, id: string): number {
  let depth = 0;
  let current = model.contentParent.get(id);
  while (current && depth < 64) {
    depth++;
    current = model.contentParent.get(current);
  }
  return depth;
}

/** The paragraphs a node shows, or an empty list. */
export function nodeParagraphs(model: DiagramModel, state: NodeState): DiagramParagraph[] {
  // Only the text algorithm lays text out; a shape node linked to content draws none.
  if (!state.node.showsText || state.node.algorithm.type !== 'tx') return [];
  const shown = model.presOf.get(state.node.pres.modelId) ?? [];
  if (shown.length === 0) return [];
  const assocDepth =
    state.node.assocType === 'node' || state.node.assocType === 'asst'
      ? depthOf(model, state.node.assoc)
      : Math.min(...shown.map((id) => depthOf(model, id)));
  const out: DiagramParagraph[] = [];
  for (const id of shown) {
    const point = model.points.get(id);
    if (!point) continue;
    const level = Math.max(0, depthOf(model, id) - assocDepth);
    for (const paragraph of paragraphsOf(dgmChild(point.element, 't'))) {
      if (out.length >= MAX_SHAPE_PARAGRAPHS) return out;
      out.push({
        element: paragraph,
        level,
        text: paragraphText(paragraph),
        explicitSize: explicitRunSize(paragraph),
      });
    }
  }
  return out;
}

export function hasVisibleText(paragraphs: readonly DiagramParagraph[]): boolean {
  return paragraphs.some((paragraph) => paragraph.text.trim() !== '');
}

function normalizeDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

function isQuarterTurn(degrees: number): boolean {
  const turns = degrees / 90;
  return Math.abs(turns - Math.round(turns)) < 1e-9 && Math.round(turns) % 2 !== 0;
}

/**
 * A node's box as the drawing stores it: before its rotation. Algorithms place the turned
 * box of a shape the layout turns by a quarter, so its sides swap about the centre; a
 * connector's box is already along its own axis.
 */
export function storedBox(state: NodeState): Box | null {
  const box = state.box;
  if (!box) return null;
  if (!isQuarterTurn(state.node.shape.rotation)) return { ...box };
  return { x: box.x + (box.w - box.h) / 2, y: box.y + (box.h - box.w) / 2, w: box.h, h: box.w };
}

/** A node's rotation in degrees, [0, 360). */
export function nodeRotation(state: NodeState): number {
  return normalizeDegrees(state.node.shape.rotation + state.rotation);
}

/** Where text lays out: a box with its own turn, centred where the drawing puts it. */
export interface TextFrame {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** The text box's turn on top of the shape's, in degrees. */
  readonly rotation: number;
}

/**
 * The text frame of a shape: its geometry's text rectangle, turned with the shape. Text
 * kept upright (`autoTxRot="upr"`, the default) turns back by the shape's rotation; text
 * that follows gravity (`grav`) flips only when it would read upside down.
 */
export function shapeTextFrame(
  preset: string | null,
  box: Box,
  adjust: ReadonlyMap<string, number> | null,
  rotationDegrees: number,
  autoTextRotation: string
): TextFrame {
  const r = normalizeDegrees(rotationDegrees);
  const definition = preset ? presetGeometryDefinition(preset) : null;
  const evaluated = definition
    ? evaluateGeometry(definition, box.w, box.h, adjust ?? undefined)
    : null;
  const rect = evaluated?.textRect ?? { left: 0, top: 0, right: box.w, bottom: box.h };
  const width = Math.max(0, rect.right - rect.left);
  const height = Math.max(0, rect.bottom - rect.top);
  // The rectangle's centre, relative to the shape's centre, turns with the shape.
  const dx = (rect.left + rect.right) / 2 - box.w / 2;
  const dy = (rect.top + rect.bottom) / 2 - box.h / 2;
  const radians = (r * Math.PI) / 180;
  const cx = box.x + box.w / 2 + dx * Math.cos(radians) - dy * Math.sin(radians);
  const cy = box.y + box.h / 2 + dx * Math.sin(radians) + dy * Math.cos(radians);
  let rotation = 0;
  if (autoTextRotation === 'upr') rotation = r === 0 ? 0 : 360 - r;
  else if (autoTextRotation === 'grav') rotation = r > 90 && r < 270 ? 180 : 0;
  const swap = isQuarterTurn(rotation);
  const w = swap ? height : width;
  const h = swap ? width : height;
  return { x: cx - w / 2, y: cy - h / 2, w, h, rotation };
}

export interface TextStyle {
  readonly primary: number;
  readonly secondary: number;
  /** Margins in EMU: left, top, right, bottom. */
  readonly margins: readonly [number, number, number, number];
}

/** Font sizes and margins of a node, with the defaults the gallery definitions rely on. */
export function textStyle(state: NodeState): TextStyle {
  const primary = state.customFontSize ?? state.values.get('primFontSz') ?? 65;
  // Without a secondary size, child text is 78% of the primary size in whole points.
  const secondary =
    state.customFontSize ??
    state.values.get('secFontSz') ??
    Math.max(1, Math.round(primary * SECONDARY_FONT_SCALE));
  // A margin no constraint sets is 0.56 of the primary size, for child text too.
  const fallback = DEFAULT_MARGIN_SCALE * primary * EMU_PER_POINT;
  const margin = (key: string) => Math.max(0, state.values.get(key) ?? fallback);
  return {
    primary,
    secondary,
    margins: [margin('lMarg'), margin('tMarg'), margin('rMarg'), margin('bMarg')],
  };
}

export interface FitResult {
  readonly fits: boolean;
  /** Whether every word fits the line width on its own. */
  readonly wordsFit: boolean;
}

/** Whether a node's text fits its text rectangle at its solved sizes. */
export function textFits(
  state: NodeState,
  paragraphs: readonly DiagramParagraph[],
  rectangle: Box,
  measurer: DiagramTextMeasurer,
  family: string
): FitResult {
  const style = textStyle(state);
  const [l, t, r, b] = style.margins;
  const width = (rectangle.w - l - r) / EMU_PER_POINT;
  const height = (rectangle.h - t - b) / EMU_PER_POINT;
  if (!(width > 0) || !(height > 0)) return { fits: false, wordsFit: false };
  let used = 0;
  let wordsFit = true;
  paragraphs.forEach((paragraph, index) => {
    const size = paragraph.explicitSize ?? (paragraph.level > 0 ? style.secondary : style.primary);
    const line = measurer.lineHeight(size, family) * PARENT_LINE_SPACING;
    const indent = paragraph.level > 0 ? size * 0.409 * paragraph.level : 0;
    const available = width - indent;
    let lines = 0;
    for (const hard of paragraph.text.split('\n')) {
      lines++;
      let current = 0;
      const space = measurer.width(' ', size, family, false);
      for (const word of hard.split(/\s+/)) {
        if (word === '') continue;
        const w = measurer.width(word, size, family, false);
        // A word at a size the content sets itself overflows whatever the rules do.
        if (w > available && paragraph.explicitSize === null) wordsFit = false;
        if (current === 0) current = w;
        else if (current + space + w <= available) current += space + w;
        else {
          lines++;
          current = w;
        }
        // A word wider than the line breaks across lines of its own.
        if (w > available && available > 0) lines += Math.ceil(w / available) - 1;
      }
    }
    used += lines * line;
    if (index < paragraphs.length - 1) {
      used += spaceAfter(state, paragraph.level) * measurer.lineHeight(size, family);
    }
  });
  return { fits: wordsFit && used <= height + 0.01, wordsFit };
}

/** The geometry a node draws with: an algorithm's choice, else its shape type. */
export function nodePreset(state: NodeState): string | null {
  const own = userGeometry(state);
  if (own) return own.preset;
  return state.preset ?? state.node.shape.type;
}

/** A presentation point's own geometry (`dgm:spPr/a:prstGeom`): a shape the user changed. */
function userGeometry(
  state: NodeState
): { readonly preset: string; readonly adjust: Map<string, number> } | null {
  const spPr = state.node.pres.spPr;
  if (!spPr) return null;
  for (const node of spPr.children) {
    if (!isElement(node) || node.namespaceUri !== A || node.localName !== 'prstGeom') continue;
    const preset = node.attributes.find((attribute) => attribute.localName === 'prst')?.value;
    if (!preset || !presetGeometryDefinition(preset)) return null;
    const adjust = new Map<string, number>();
    for (const list of node.children) {
      if (!isElement(list) || list.localName !== 'avLst') continue;
      for (const gd of list.children) {
        if (!isElement(gd) || gd.localName !== 'gd') continue;
        const name = gd.attributes.find((attribute) => attribute.localName === 'name')?.value;
        const formula = gd.attributes.find((attribute) => attribute.localName === 'fmla')?.value;
        const match = formula ? /^val (-?\d{1,10})$/.exec(formula) : null;
        if (name && match && adjust.size < 16) adjust.set(name, Number(match[1]));
      }
    }
    return { preset, adjust };
  }
  return null;
}

/** Adjust values by guide name: an algorithm's, else the shape's `adjLst` by index. */
export function nodeAdjust(state: NodeState): Map<string, number> | null {
  const own = userGeometry(state);
  if (own) return own.adjust.size > 0 ? own.adjust : null;
  if (state.adjust) return state.adjust;
  const preset = nodePreset(state);
  if (!preset || state.node.shape.adjust.size === 0) return null;
  const definition = presetGeometryDefinition(preset);
  if (!definition) return null;
  const out = new Map<string, number>();
  for (const [index, value] of state.node.shape.adjust) {
    const guide = definition.avLst[index - 1];
    // Angles are degrees in the layout and 60000ths of a degree in the geometry.
    if (guide) out.set(guide.name, guideValue(preset, guide.name, value));
  }
  return out;
}

const ANGLE_GUIDES = new Set(['adj1', 'adj2', 'adj3', 'adj4', 'adj5']);
const ANGLE_PRESETS = new Set(['pie', 'blockArc', 'arc', 'chord', 'circularArrow']);

function guideValue(preset: string, name: string, value: number): number {
  if (ANGLE_PRESETS.has(preset) && ANGLE_GUIDES.has(name) && Math.abs(value) > 1) {
    return Math.round(value * 60_000);
  }
  return Math.round(value * 100_000);
}

/** The text frame of a solved node, from its own geometry. */
export function nodeTextFrame(state: NodeState, owner: NodeState = state): TextFrame | null {
  const box = storedBox(owner);
  if (!box) return null;
  const autoRotation = state.node.algorithm.params.get('autoTxRot') ?? 'upr';
  return shapeTextFrame(
    nodePreset(owner),
    box,
    nodeAdjust(owner),
    nodeRotation(owner),
    autoRotation
  );
}

/**
 * The node whose geometry a text node lays out in: a connector's text (`conn` shape) uses
 * the connector it labels; any other text uses its own box.
 */
export function textOwner(solution: LayoutSolution, state: NodeState): NodeState {
  const parent = state.node.parent;
  if (state.node.shape.type === 'conn' && parent) return solution.states[parent.index]!;
  return state;
}
