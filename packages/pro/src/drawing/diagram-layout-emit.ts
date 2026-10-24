/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A solved diagram layout written as the drawing part Office saves (`dsp:drawing`), so the
// saved-drawing renderer draws it unchanged.
//
// One `dsp:sp` per presentation point with geometry, in tree order. A text-only node
// (`hideGeom`) lends its text and text frame to the nearest drawn shape before it that
// shows the same content and has no text yet; with no such shape it draws on its own,
// without fill or outline. Every value taken from a diagram part is escaped.

import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  escapeXmlAttribute,
  isElement,
  type OoxmlElement,
  type ShapeSchemeColorResolver,
} from '@docx-editor.dev/core/store';
import type { DiagramModel } from './diagram-layout-model.ts';
import { layoutVariable } from './diagram-layout-tree.ts';
import { EMU_PER_POINT, type LayoutSolution, type NodeState } from './diagram-layout-solve.ts';
import {
  colorMarkup,
  pickColor,
  serializeDrawingElement,
  styleReferences,
  type PickedColor,
} from './diagram-layout-style.ts';
import {
  hasVisibleText,
  nodeAdjust,
  nodeParagraphs,
  nodePreset,
  nodeRotation,
  nodeTextFrame,
  PARENT_LINE_SPACING,
  spaceAfter,
  storedBox,
  textOwner,
  textStyle,
  type DiagramParagraph,
} from './diagram-layout-text.ts';
import { attr } from './diagram-layout-model.ts';

const A = DRAWINGML_MAIN_NAMESPACE_URI;
const DSP_NAMESPACE = 'http://schemas.microsoft.com/office/drawing/2008/diagram';
/** Shapes one synthesized drawing may hold, as the renderer's own cap. */
export const MAX_SYNTHESIZED_SHAPES = 512;
const OPEN_PRESETS = new Set(['arc', 'line', 'lineInv', 'straightConnector1', 'bentConnector3']);

export interface DiagramShape {
  readonly owner: NodeState;
  /** The node whose text the shape shows, or null. */
  text: NodeState | null;
  /** Drawn only for its text: no fill and no outline. */
  readonly textOnly: boolean;
}

/** The drawn shapes of a solution, with text merged into its shape. Null past the cap. */
export function collectShapes(
  solution: LayoutSolution,
  model: DiagramModel
): DiagramShape[] | null {
  const shapes: DiagramShape[] = [];
  for (const state of solution.states) {
    if (state.hidden || !state.box || !(state.box.w > 0) || !(state.box.h > 0)) {
      // Text the layout gives no room must not vanish: the diagram keeps its placeholder.
      if (!state.hidden && hasVisibleText(nodeParagraphs(model, state))) return null;
      continue;
    }
    const preset = nodePreset(state);
    const paragraphs = nodeParagraphs(model, state);
    const shows = state.node.showsText && paragraphs.length > 0;
    const geometry =
      state.path !== null ||
      (preset !== null && preset !== 'conn' && !state.node.shape.hideGeometry);
    if (geometry) {
      shapes.push({ owner: state, text: shows ? state : null, textOnly: false });
    } else if (shows) {
      let target: DiagramShape | null = null;
      // Only the nearest shape of the same content can take the text, and only while it
      // has none: a second text of one content point draws on its own.
      for (let i = shapes.length - 1; i >= 0; i--) {
        const candidate = shapes[i]!;
        if (candidate.textOnly || candidate.owner.node.assoc !== state.node.assoc) continue;
        // Open outlines (arcs, lines) hold no text; a later text draws on its own.
        if (candidate.owner.path || OPEN_PRESETS.has(nodePreset(candidate.owner) ?? '')) continue;
        if (!candidate.text) target = candidate;
        break;
      }
      if (target) target.text = state;
      else if (hasVisibleText(paragraphs)) {
        shapes.push({ owner: state, text: state, textOnly: true });
      }
    }
    if (shapes.length > MAX_SYNTHESIZED_SHAPES) return null;
  }
  return shapes;
}

function emu(value: number): string {
  return String(Math.round(Number.isFinite(value) ? value : 0));
}

function angle(degrees: number): number {
  return Math.round((((degrees % 360) + 360) % 360) * 60_000) % 21_600_000;
}

interface EmitContext {
  readonly solution: LayoutSolution;
  readonly model: DiagramModel;
  readonly styleDef: OoxmlElement | null;
  readonly colorsDef: OoxmlElement | null;
  readonly resolveSchemeColor?: ShapeSchemeColorResolver;
}

function styleIndex(state: NodeState): { index: number; count: number } {
  const prSet = state.node.pres.prSet;
  const index = Number(attr(prSet, 'presStyleIdx') ?? '0');
  const count = Number(attr(prSet, 'presStyleCnt') ?? '1');
  return {
    index: Number.isInteger(index) && index >= 0 ? index : 0,
    count: Number.isInteger(count) && count > 0 ? count : 1,
  };
}

function referenceMarkup(
  name: string,
  idx: string,
  picked: PickedColor | null,
  fallback: OoxmlElement | null
): string {
  const color = colorMarkup(picked) ?? (fallback ? serializeDrawingElement(fallback) : null) ?? '';
  return `<a:${name} idx="${escapeXmlAttribute(idx)}">${color}</a:${name}>`;
}

function styleMarkup(context: EmitContext, state: NodeState): string {
  const label = state.node.styleLabel;
  const refs = styleReferences(context.styleDef, label);
  const { index, count } = styleIndex(state);
  const pick = (list: string) =>
    pickColor(context.colorsDef, label, list, index, count, context.resolveSchemeColor);
  return (
    '<dsp:style>' +
    referenceMarkup('lnRef', refs.line.idx, pick('linClrLst'), refs.line.color) +
    referenceMarkup('fillRef', refs.fill.idx, pick('fillClrLst'), refs.fill.color) +
    referenceMarkup('effectRef', refs.effect.idx, pick('effectClrLst'), refs.effect.color) +
    referenceMarkup('fontRef', refs.font.idx, pick('txFillClrLst'), refs.font.color) +
    '</dsp:style>'
  );
}

/** A presentation point's own shape properties (user formatting), DrawingML only. */
const FILLS = new Set(['noFill', 'solidFill', 'gradFill', 'blipFill', 'pattFill', 'grpFill']);

/** The paint category an `spPr` child belongs to: one fill, one outline, one effect list. */
function paintSlot(localName: string): string | null {
  if (localName === 'xfrm' || localName === 'prstGeom' || localName === 'custGeom') return null;
  return FILLS.has(localName) ? 'fill' : localName;
}

/** Content points whose formatting one shape reads. */
const MAX_PAINT_SOURCES = 64;

/**
 * User formatting on a shape: the presentation point's own `spPr`, then the content points
 * the shape and the text merged into it show (`presOf`), in order: a step filled in another
 * colour, a connector line recoloured, child text shown in a box of its own takes its
 * first child's fill. Each slot comes from the first source that sets it. Geometry and
 * position come from the layout; a line connector keeps its own empty fill.
 */
function overrideMarkup(context: EmitContext, shape: DiagramShape): string {
  const state = shape.owner;
  const sources = [state.node.pres.spPr];
  const shown: string[] = [];
  for (const node of shape.text && shape.text !== state ? [state, shape.text] : [state]) {
    for (const id of context.model.presOf.get(node.node.pres.modelId) ?? []) {
      if (shown.length < MAX_PAINT_SOURCES && !shown.includes(id)) shown.push(id);
    }
  }
  for (const id of shown) sources.push(context.model.points.get(id)?.spPr ?? null);
  const slots = new Map<string, string>();
  for (const spPr of sources) {
    if (!spPr) continue;
    for (const child of spPr.children) {
      if (!isElement(child) || child.namespaceUri !== A) continue;
      const slot = paintSlot(child.localName);
      if (slot === null || slots.has(slot) || (slot === 'fill' && state.path)) continue;
      slots.set(slot, serializeDrawingElement(child) ?? '');
    }
  }
  // Fill, outline, effects: the order `spPr` keeps.
  const order = ['fill', 'ln', 'effectLst', 'effectDag', 'scene3d', 'sp3d'];
  let out = '';
  for (const slot of order) out += slots.get(slot) ?? '';
  for (const [slot, markup] of slots) if (!order.includes(slot)) out += markup;
  return out;
}

function pathMarkup(path: readonly { readonly x: number; readonly y: number }[]): string {
  let commands = '';
  path.forEach((point, i) => {
    const name = i === 0 ? 'moveTo' : 'lnTo';
    commands += `<a:${name}><a:pt x="${emu(point.x)}" y="${emu(point.y)}"/></a:${name}>`;
  });
  return (
    '<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="0" b="0"/>' +
    `<a:pathLst><a:path>${commands}</a:path></a:pathLst></a:custGeom><a:noFill/>`
  );
}

function geometryMarkup(state: NodeState): string {
  if (state.path) return pathMarkup(state.path);
  const preset = nodePreset(state) ?? 'rect';
  const adjust = nodeAdjust(state);
  let guides = '';
  if (adjust) {
    for (const [name, value] of adjust) {
      guides += `<a:gd name="${escapeXmlAttribute(name)}" fmla="val ${Math.round(value)}"/>`;
    }
  }
  return `<a:prstGeom prst="${escapeXmlAttribute(preset)}"><a:avLst>${guides}</a:avLst></a:prstGeom>`;
}

function runProperties(source: OoxmlElement | null, sizePt: number): string {
  let attributes = '';
  let children = '';
  let explicit: string | null = null;
  if (source) {
    for (const attribute of source.attributes) {
      if (attribute.namespaceUri !== '' || attribute.localName === 'kern') continue;
      // A size the content sets itself stands; the rule loop sizes the rest.
      if (attribute.localName === 'sz') {
        if (/^\d{3,6}$/.test(attribute.value)) explicit = attribute.value;
        continue;
      }
      if (!/^[A-Za-z][\w.-]*$/.test(attribute.localName)) continue;
      attributes += ` ${attribute.localName}="${escapeXmlAttribute(attribute.value)}"`;
    }
    for (const child of source.children) {
      if (isElement(child) && child.namespaceUri === A) {
        children += serializeDrawingElement(child) ?? '';
      }
    }
  }
  const size = explicit ?? String(Math.round(sizePt * 100));
  const head = `<a:rPr${attributes} sz="${size}" kern="1200"`;
  return children === '' ? `${head}/>` : `${head}>${children}</a:rPr>`;
}

function childOf(element: OoxmlElement, localName: string): OoxmlElement | null {
  for (const node of element.children) {
    if (isElement(node) && node.namespaceUri === A && node.localName === localName) return node;
  }
  return null;
}

function paragraphMarkup(
  paragraph: DiagramParagraph,
  sizePt: number,
  textNode: NodeState,
  model: DiagramModel
): string {
  const params = textNode.node.algorithm.params;
  const child = paragraph.level > 0;
  const ownAlign = childOf(paragraph.element, 'pPr')?.attributes.find(
    (attribute) => attribute.localName === 'algn'
  )?.value;
  const align =
    ownAlign && /^(l|ctr|r|just|dist|justLow|thaiDist)$/.test(ownAlign)
      ? ownAlign
      : child
        ? (params.get('shpTxLTRAlignCh') ?? 'l')
        : (params.get('parTxLTRAlign') ?? 'ctr');
  const bullets = child && layoutVariable(model, textNode.node.pres, 'bulletEnabled') === '1';
  const indent = bullets ? Math.round(sizePt * 0.409 * EMU_PER_POINT) : 0;
  const marL = bullets ? indent * paragraph.level : 0;
  const after = spaceAfter(textNode, paragraph.level);
  let out =
    `<a:p><a:pPr marL="${marL}" lvl="${paragraph.level}" indent="${-indent}" ` +
    `algn="${escapeXmlAttribute(align)}" defTabSz="${Math.round(sizePt * 44_450)}">` +
    `<a:lnSpc><a:spcPct val="${Math.round(PARENT_LINE_SPACING * 100_000)}"/></a:lnSpc>` +
    '<a:spcBef><a:spcPct val="0"/></a:spcBef>' +
    `<a:spcAft><a:spcPct val="${Math.round(after * 100_000)}"/></a:spcAft>` +
    (bullets ? '<a:buChar char="&#x2022;"/>' : '<a:buNone/>') +
    '</a:pPr>';
  let runs = 0;
  for (const node of paragraph.element.children) {
    if (!isElement(node) || node.namespaceUri !== A) continue;
    if (node.localName === 'r') {
      const t = childOf(node, 't');
      const text = t ? (serializeDrawingElement(t) ?? '<a:t/>') : '<a:t/>';
      out += `<a:r>${runProperties(childOf(node, 'rPr'), sizePt)}${text}</a:r>`;
      runs++;
    } else if (node.localName === 'br') {
      out += `<a:br>${runProperties(childOf(node, 'rPr'), sizePt)}</a:br>`;
    }
  }
  const end = childOf(paragraph.element, 'endParaRPr');
  if (runs === 0 || end) {
    out += runProperties(end, sizePt)
      .replace('<a:rPr', '<a:endParaRPr')
      .replace('</a:rPr>', '</a:endParaRPr>');
  }
  return `${out}</a:p>`;
}

function anchorOf(state: NodeState): string {
  const vertical = state.node.algorithm.params.get('txAnchorVert') ?? 'mid';
  return vertical === 't' ? 't' : vertical === 'b' ? 'b' : 'ctr';
}

function textMarkup(context: EmitContext, shape: DiagramShape): string {
  const textNode = shape.text;
  if (!textNode) return '';
  const paragraphs = nodeParagraphs(context.model, textNode);
  const style = textStyle(textNode);
  const [l, t, r, b] = style.margins;
  let body =
    `<dsp:txBody><a:bodyPr spcFirstLastPara="0" vert="horz" wrap="square" lIns="${emu(l)}" ` +
    `tIns="${emu(t)}" rIns="${emu(r)}" bIns="${emu(b)}" numCol="1" spcCol="1270" ` +
    `anchor="${anchorOf(textNode)}" anchorCtr="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>`;
  for (const paragraph of paragraphs) {
    const size = Math.max(1, Math.round(paragraph.level > 0 ? style.secondary : style.primary));
    body += paragraphMarkup(paragraph, size, textNode, context.model);
  }
  body += '</dsp:txBody>';
  // Merged text keeps its own frame unless it labels a connector.
  const frame = nodeTextFrame(textNode, textOwner(context.solution, textNode));
  if (frame) {
    const rot = frame.rotation ? ` rot="${angle(frame.rotation)}"` : '';
    body +=
      `<dsp:txXfrm${rot}><a:off x="${emu(frame.x)}" y="${emu(frame.y)}"/>` +
      `<a:ext cx="${emu(frame.w)}" cy="${emu(frame.h)}"/></dsp:txXfrm>`;
  }
  return body;
}

function shapeMarkup(context: EmitContext, shape: DiagramShape): string | null {
  const state = shape.owner;
  const box = storedBox(state);
  if (!box) return null;
  const rotation = nodeRotation(state);
  const rot = rotation ? ` rot="${angle(rotation)}"` : '';
  const flip = state.flipH ? ' flipH="1"' : '';
  const paint = shape.textOnly
    ? '<a:noFill/><a:ln><a:noFill/></a:ln>'
    : overrideMarkup(context, shape);
  return (
    `<dsp:sp modelId="${escapeXmlAttribute(state.node.pres.modelId)}">` +
    '<dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>' +
    `<dsp:spPr><a:xfrm${rot}${flip}><a:off x="${emu(box.x)}" y="${emu(box.y)}"/>` +
    `<a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></a:xfrm>` +
    geometryMarkup(state) +
    paint +
    '</dsp:spPr>' +
    styleMarkup(context, shape.text ?? state) +
    textMarkup(context, shape) +
    '</dsp:sp>'
  );
}

/** The drawing part markup for a solved layout, or null past a cap. */
export function emitDiagramDrawing(
  solution: LayoutSolution,
  model: DiagramModel,
  styleDef: OoxmlElement | null,
  colorsDef: OoxmlElement | null,
  resolveSchemeColor?: ShapeSchemeColorResolver
): { readonly xml: string; readonly shapes: readonly DiagramShape[] } | null {
  const shapes = collectShapes(solution, model);
  if (!shapes) return null;
  const context: EmitContext = { solution, model, styleDef, colorsDef, resolveSchemeColor };
  let body = '';
  for (const shape of shapes) {
    const markup = shapeMarkup(context, shape);
    if (markup) body += markup;
  }
  const xml =
    `<dsp:drawing xmlns:dsp="${DSP_NAMESPACE}" xmlns:a="${A}"><dsp:spTree>` +
    '<dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr>' +
    `<dsp:grpSpPr/>${body}</dsp:spTree></dsp:drawing>`;
  return { xml, shapes };
}
