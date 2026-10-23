// Layout algorithms: how a node places its children inside its own box once their values
// are solved. `composite` reads explicit edges and sizes, `lin` lines children up and
// scales them to fit, `conn` lays a connector between its neighbours. `tx` and `sp` place
// nothing of their own; their children take the node's box.

import type { DiagramModel } from './diagram-layout-model.ts';
import { compositeAxis, type Box, type NodeState } from './diagram-layout-solve.ts';

export interface PlacementContext {
  readonly model: DiagramModel;
  readonly states: readonly NodeState[];
  readonly readValue: (state: NodeState, type: string) => number | null;
  /** Re-solve a node's own constraints, leaving `except` as it is. */
  readonly resolveSelf: (state: NodeState, except: string) => void;
}

const SUPPORTED = new Set(['composite', 'lin', 'conn', 'tx', 'sp']);

export function isSupportedAlgorithm(type: string): boolean {
  return SUPPORTED.has(type);
}

function childStates(context: PlacementContext, state: NodeState): NodeState[] {
  return state.node.children.map((child) => context.states[child.index]!);
}

function placeComposite(context: PlacementContext, state: NodeState): void {
  const box = state.box!;
  for (const child of childStates(context, state)) {
    const [x, w] = compositeAxis(child.values, ['l', 'r', 'w', 'ctrX'], box.w);
    const [y, h] = compositeAxis(child.values, ['t', 'b', 'h', 'ctrY'], box.h);
    child.box = { x: box.x + x, y: box.y + y, w: Math.max(0, w), h: Math.max(0, h) };
  }
}

/**
 * `lin`: children in a row or column. The primary sizes scale down together until the line
 * fits; each child then re-solves its own constraints from its new primary size (a node as
 * tall as 0.6 of its width stays so). A line still too thick scales down as a whole.
 */
function placeLinear(context: PlacementContext, state: NodeState): void {
  const box = state.box!;
  const params = state.node.algorithm.params;
  const direction = params.get('linDir') ?? 'fromL';
  const horizontal = direction === 'fromL' || direction === 'fromR';
  const reverse = direction === 'fromR' || direction === 'fromB';
  const children = childStates(context, state);
  if (children.length === 0) return;
  const primaryKey = horizontal ? 'w' : 'h';
  const crossKey = horizontal ? 'h' : 'w';
  const primaryBox = horizontal ? box.w : box.h;
  const crossBox = horizontal ? box.h : box.w;
  const gap = state.values.get('sp') ?? 0;
  const primaries = children.map((child) => Math.max(0, child.values.get(primaryKey) ?? 0));
  const total = primaries.reduce((sum, size) => sum + size, 0) + gap * (children.length - 1);
  const scale = total > primaryBox && total > 0 ? primaryBox / total : 1;
  const crosses = children.map((child, index) => {
    if (scale !== 1) {
      child.values.set(primaryKey, primaries[index]! * scale);
      context.resolveSelf(child, primaryKey);
    }
    return Math.max(0, child.values.get(crossKey) ?? crossBox);
  });
  let sizes = children.map((_, index) => ({
    primary: primaries[index]! * scale,
    cross: crosses[index]!,
  }));
  let spacing = gap * scale;
  const maxCross = sizes.reduce((max, size) => Math.max(max, size.cross), 0);
  if (maxCross > crossBox && maxCross > 0) {
    const shrink = crossBox / maxCross;
    sizes = sizes.map((size) => ({ primary: size.primary * shrink, cross: size.cross * shrink }));
    spacing *= shrink;
  }
  const used = sizes.reduce((sum, size) => sum + size.primary, 0) + spacing * (children.length - 1);
  const groupAlign = horizontal ? params.get('horzAlign') : params.get('vertAlign');
  let cursor = (primaryBox - used) / 2;
  if (groupAlign === 'l' || groupAlign === 't') cursor = reverse ? primaryBox - used : 0;
  else if (groupAlign === 'r' || groupAlign === 'b') cursor = reverse ? 0 : primaryBox - used;
  const crossAlign = horizontal
    ? (params.get('nodeVertAlign') ?? 'mid')
    : (params.get('nodeHorzAlign') ?? 'ctr');
  const order = reverse ? [...children.keys()].reverse() : [...children.keys()];
  for (const index of order) {
    const child = children[index]!;
    const { primary, cross } = sizes[index]!;
    let crossStart = (crossBox - cross) / 2;
    if (crossAlign === 't' || crossAlign === 'l') crossStart = 0;
    else if (crossAlign === 'b' || crossAlign === 'r') crossStart = crossBox - cross;
    child.box = horizontal
      ? { x: box.x + cursor, y: box.y + crossStart, w: primary, h: cross }
      : { x: box.x + crossStart, y: box.y + cursor, w: cross, h: primary };
    cursor += primary + spacing;
  }
}

interface Point {
  readonly x: number;
  readonly y: number;
}

function centre(box: Box): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Where the ray from a box centre towards `toward` leaves the box (or its ellipse). */
function edgePoint(box: Box, toward: Point, elliptic: boolean): Point {
  const c = centre(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const rx = box.w / 2;
  const ry = box.h / 2;
  let t: number;
  if (elliptic && rx > 0 && ry > 0) {
    t = 1 / Math.sqrt((dx * dx) / (rx * rx) + (dy * dy) / (ry * ry));
  } else {
    const tx = dx === 0 ? Infinity : rx / Math.abs(dx);
    const ty = dy === 0 ? Infinity : ry / Math.abs(dy);
    t = Math.min(tx, ty);
  }
  return { x: c.x + dx * t, y: c.y + dy * t };
}

const ELLIPTIC = new Set(['ellipse', 'circle', 'donut', 'pie', 'blockArc', 'chord']);

function siblingNamed(
  context: PlacementContext,
  state: NodeState,
  name: string | undefined,
  direction: -1 | 1
): NodeState | null {
  const parent = state.node.parent;
  if (!parent) return null;
  const siblings = parent.children.map((child) => context.states[child.index]!);
  if (name) {
    // A named end is the nearest sibling of that name in the connector's direction.
    const at = siblings.indexOf(state);
    for (let i = at + direction; i >= 0 && i < siblings.length; i += direction) {
      if (siblings[i]!.node.name === name) return siblings[i]!;
    }
    return siblings.find((sibling) => sibling.node.name === name) ?? null;
  }
  const at = siblings.indexOf(state);
  for (let i = at + direction; i >= 0 && i < siblings.length; i += direction) {
    const sibling = siblings[i]!;
    if (sibling.node.algorithm.type !== 'conn' && sibling.box) return sibling;
  }
  return null;
}

function padding(state: NodeState, type: 'begPad' | 'endPad', distance: number): number {
  for (const constraint of state.node.constraints) {
    if (constraint.type !== type || constraint.for !== 'self') continue;
    if (constraint.refType === 'connDist') return distance * constraint.fact;
    if (!Number.isNaN(constraint.val)) return constraint.val * 36_000;
  }
  return state.values.get(type) ?? 0;
}

/**
 * `conn` (2D): an arrow along the line between the attach points of its source and
 * destination, shortened by the begin and end pads, as thick as the connector's slot.
 */
function placeConnector(context: PlacementContext, state: NodeState): void {
  const params = state.node.algorithm.params;
  const source = siblingNamed(context, state, params.get('srcNode'), -1);
  const target = siblingNamed(context, state, params.get('dstNode'), 1);
  const slot = state.box!;
  if (!source?.box || !target?.box) {
    state.hidden = true;
    return;
  }
  const from = centre(source.box);
  const to = centre(target.box);
  const start = edgePoint(source.box, to, ELLIPTIC.has(source.node.shape.type ?? ''));
  const end = edgePoint(target.box, from, ELLIPTIC.has(target.node.shape.type ?? ''));
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.hypot(dx, dy);
  state.values.set('connDist', distance);
  const begin = padding(state, 'begPad', distance);
  const finish = padding(state, 'endPad', distance);
  const length = Math.max(0, distance - begin - finish);
  const thickness = slot.h;
  const unitX = distance > 0 ? dx / distance : 1;
  const unitY = distance > 0 ? dy / distance : 0;
  const mid = {
    x: start.x + unitX * (begin + length / 2),
    y: start.y + unitY * (begin + length / 2),
  };
  state.box = { x: mid.x - length / 2, y: mid.y - thickness / 2, w: length, h: thickness };
  state.rotation = (Math.atan2(dy, dx) * 180) / Math.PI;
  const begStyle = params.get('begSty') ?? 'noArr';
  const endStyle = params.get('endSty') ?? 'arr';
  state.preset =
    begStyle === 'arr' && endStyle === 'arr'
      ? 'leftRightArrow'
      : begStyle === 'arr'
        ? 'leftArrow'
        : endStyle === 'arr'
          ? 'rightArrow'
          : 'rect';
  if (state.preset === 'leftArrow') state.preset = 'rightArrow';
  if (begStyle === 'arr' && endStyle !== 'arr') state.flipH = true;
  state.adjust = new Map([
    ['adj1', 60_000],
    ['adj2', 50_000],
  ]);
}

/**
 * A composite with an aspect ratio (`ar`, width over height) keeps the largest box of that
 * ratio inside its own, aligned by `horzAlign` and `vertAlign`, before its children solve.
 */
export function fitOwnBox(state: NodeState): void {
  const box = state.box;
  if (!box || state.node.algorithm.type !== 'composite') return;
  const params = state.node.algorithm.params;
  const ratio = Number(params.get('ar') ?? '0');
  if (!(ratio > 0) || !Number.isFinite(ratio) || box.w <= 0 || box.h <= 0) return;
  const w = Math.min(box.w, box.h * ratio);
  const h = w / ratio;
  const horizontal = params.get('horzAlign') ?? 'ctr';
  const vertical = params.get('vertAlign') ?? 'mid';
  const x =
    horizontal === 'l' ? box.x : horizontal === 'r' ? box.x + box.w - w : box.x + (box.w - w) / 2;
  const y =
    vertical === 't' ? box.y : vertical === 'b' ? box.y + box.h - h : box.y + (box.h - h) / 2;
  state.box = { x, y, w, h };
}

/** Place a node's children. False when the algorithm is not supported. */
export function placeChildren(context: PlacementContext, state: NodeState): boolean {
  const type = state.node.algorithm.type;
  if (!SUPPORTED.has(type)) return false;
  if (type === 'conn') {
    if ((state.node.algorithm.params.get('dim') ?? '2D') !== '2D') return false;
    placeConnector(context, state);
  }
  const box = state.box;
  if (!box) return true;
  if (type === 'composite') placeComposite(context, state);
  else if (type === 'lin') placeLinear(context, state);
  else {
    for (const child of childStates(context, state)) child.box = { ...box };
  }
  return true;
}
