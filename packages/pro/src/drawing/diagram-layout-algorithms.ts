/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Layout algorithms: how a node places its children inside its own box once their values
// are solved. `composite` reads explicit edges and sizes, `lin` lines children up and
// scales them to fit, `conn` lays a connector between its neighbours. `tx` and `sp` place
// nothing of their own; their children take the node's box.

import type { DiagramModel } from './diagram-layout-model.ts';
import { placeCycle, placePyramid, placeSnake } from './diagram-layout-flow.ts';
import {
  isHierarchyAlgorithm,
  placeHierarchy,
  placeLineConnector,
} from './diagram-layout-hierarchy.ts';
import { compositeAxis, type Box, type NodeState } from './diagram-layout-solve.ts';

export interface PlacementContext {
  readonly model: DiagramModel;
  readonly states: readonly NodeState[];
  readonly readValue: (state: NodeState, type: string) => number | null;
  /** Keep a value an algorithm set from later constraint passes. */
  readonly pin: (state: NodeState, type: string) => void;
  /** Re-solve a node's own constraints, leaving `except` as it is. */
  readonly resolveSelf: (state: NodeState, except: string) => void;
  /** Record that a line of children had to shrink by `scale` to fit its box. */
  readonly overflow: (scale: number) => void;
}

const SUPPORTED = new Set([
  'composite',
  'lin',
  'conn',
  'tx',
  'sp',
  'snake',
  'cycle',
  'hierRoot',
  'hierChild',
  'pyra',
]);

export function isSupportedAlgorithm(type: string): boolean {
  return SUPPORTED.has(type);
}

function childStates(context: PlacementContext, state: NodeState): NodeState[] {
  return state.node.children.map((child) => context.states[child.index]!);
}

/**
 * `composite`: each child at its own edges and sizes. The children together are then
 * aligned in the box (`horzAlign`, `vertAlign`; centred by default, `none` to keep them).
 */
function placeComposite(context: PlacementContext, state: NodeState): void {
  const box = state.box!;
  const children = childStates(context, state);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const child of children) {
    const [x, w] = compositeAxis(child.values, ['l', 'r', 'w', 'ctrX'], box.w);
    const [y, h] = compositeAxis(child.values, ['t', 'b', 'h', 'ctrY'], box.h);
    child.box = { x: box.x + x, y: box.y + y, w: Math.max(0, w), h: Math.max(0, h) };
    minX = Math.min(minX, child.box.x);
    maxX = Math.max(maxX, child.box.x + child.box.w);
    minY = Math.min(minY, child.box.y);
    maxY = Math.max(maxY, child.box.y + child.box.h);
  }
  if (children.length === 0) return;
  const params = state.node.algorithm.params;
  const shift = (align: string, start: number, end: number, from: number, size: number) => {
    if (align === 'none' || !(end - start < size)) return 0;
    if (align === 'l' || align === 't') return from - start;
    if (align === 'r' || align === 'b') return from + size - end;
    return from + (size - (end - start)) / 2 - start;
  };
  const dx = shift(params.get('horzAlign') ?? 'ctr', minX, maxX, box.x, box.w);
  const dy = shift(params.get('vertAlign') ?? 'mid', minY, maxY, box.y, box.h);
  if (dx === 0 && dy === 0) return;
  for (const child of children) {
    child.box = { ...child.box!, x: child.box!.x + dx, y: child.box!.y + dy };
  }
}

/**
 * The size a node's children need along `key`: summed along a line that runs that way,
 * otherwise the largest. Unbounded or unknown sizes count as 0.
 */
function naturalSize(
  context: PlacementContext,
  state: NodeState,
  key: 'w' | 'h',
  depth: number
): number {
  if (depth > 16) return 0;
  const children = childStates(context, state);
  const sizes = children.map((child) => {
    const value = child.values.get(key);
    if (value !== undefined && Number.isFinite(value)) return Math.max(0, value);
    return naturalSize(context, child, key, depth + 1);
  });
  const direction = state.node.algorithm.params.get('linDir') ?? 'fromL';
  const along =
    state.node.algorithm.type === 'lin' &&
    (key === 'w') === (direction === 'fromL' || direction === 'fromR');
  return along
    ? sizes.reduce((sum, size) => sum + size, 0)
    : sizes.reduce((max, size) => Math.max(max, size), 0);
}

/**
 * `lin`: children in a row or column. The primary sizes scale down together until the line
 * fits; each child then re-solves its own constraints from its new primary size (a node as
 * tall as 0.6 of its width stays so). A line still too thick scales down as a whole. A line
 * shorter than its box keeps its sizes and is aligned in it. Shrinking is reported as
 * overflow, which the rule loop answers with smaller text.
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
  const natural = new Set<NodeState>();
  const primaries = children.map((child) => {
    const value = child.values.get(primaryKey) ?? 0;
    if (Number.isFinite(value)) return value;
    // An unbounded size (`INF`) takes what the child's own children need.
    natural.add(child);
    return naturalSize(context, child, primaryKey, 0);
  });
  const total = primaries.reduce((sum, size) => sum + size, 0) + gap * (children.length - 1);
  // A line too long shrinks to fit; an unbounded child (`INF`) takes what its own children
  // need and no more.
  const scale = total > 0 && total > primaryBox ? primaryBox / total : 1;
  if (scale < 1) context.overflow(scale);
  const crosses = children.map((child, index) => {
    if (scale !== 1) {
      child.values.set(primaryKey, primaries[index]! * scale);
      context.resolveSelf(child, primaryKey);
      // A size taken from the child's children scales with them.
      if (natural.has(child)) {
        for (const inner of childStates(context, child)) {
          const size = inner.values.get(primaryKey);
          if (size === undefined || !Number.isFinite(size)) continue;
          inner.values.set(primaryKey, size * scale);
          context.pin(inner, primaryKey);
        }
      }
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
    context.overflow(shrink);
    sizes = sizes.map((size) => ({ primary: size.primary * shrink, cross: size.cross * shrink }));
    spacing *= shrink;
  }
  const across = sizes.length > 0 && maxCross > crossBox && maxCross > 0 ? crossBox / maxCross : 1;
  for (const child of children) {
    if (scale * across !== 1) child.flowScale.set(primaryKey, scale * across);
    if (across !== 1) child.flowScale.set(crossKey, across);
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
      ? { x: box.x + cursor, y: box.y + crossStart, w: Math.max(0, primary), h: cross }
      : { x: box.x + crossStart, y: box.y + cursor, w: cross, h: Math.max(0, primary) };
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
  // Around a cycle the last connector closes the ring on the first node.
  if (parent.algorithm.type === 'cycle') {
    const ends = direction === 1 ? siblings : [...siblings].reverse();
    return ends.find((sibling) => sibling.node.algorithm.type !== 'conn' && sibling.box) ?? null;
  }
  return null;
}

/** Pads a connector keeps from its ends when its definition sets none. */
const DEFAULT_PADS = { begPad: 0.25, endPad: 0.22 } as const;

function padding(state: NodeState, type: 'begPad' | 'endPad', distance: number): number {
  for (const constraint of state.node.constraints) {
    if (constraint.type !== type || constraint.for !== 'self') continue;
    if (constraint.refType === 'connDist') return distance * constraint.fact;
    if (!Number.isNaN(constraint.val)) return constraint.val * 36_000;
  }
  return state.values.get(type) ?? distance * DEFAULT_PADS[type];
}

/**
 * A parent transition joins the sibling showing the parent content to the one showing the
 * child content it leads to.
 */
function parentTransitionEnds(
  context: PlacementContext,
  state: NodeState
): { source: NodeState | null; target: NodeState | null } | null {
  const parent = state.node.parent;
  const child = context.model.transitionOwner.get(state.node.assoc);
  if (!parent || !child) return null;
  const owner = context.model.contentParent.get(child);
  const siblings = parent.children.map((node) => context.states[node.index]!);
  const drawn = (assoc: string | undefined) =>
    siblings.find(
      (sibling) =>
        sibling.node.assoc === assoc && sibling.node.algorithm.type !== 'conn' && sibling.box
    ) ?? null;
  return { source: drawn(owner), target: drawn(child) };
}

/**
 * `conn` (2D): an arrow along the line between the attach points of its source and
 * destination, shortened by the begin and end pads, as thick as the connector's slot.
 */
function placeConnector(context: PlacementContext, state: NodeState): void {
  const params = state.node.algorithm.params;
  const parentLink =
    state.node.assocType === 'parTrans' && !params.has('srcNode') && !params.has('dstNode')
      ? parentTransitionEnds(context, state)
      : null;
  const source = parentLink?.source ?? siblingNamed(context, state, params.get('srcNode'), -1);
  const target = parentLink?.target ?? siblingNamed(context, state, params.get('dstNode'), 1);
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
    const dim = state.node.algorithm.params.get('dim') ?? '2D';
    if (dim === '1D') placeLineConnector(context, state);
    else if (dim === '2D') placeConnector(context, state);
    else return false;
  }
  const box = state.box;
  if (!box) return true;
  if (type === 'composite') placeComposite(context, state);
  else if (type === 'lin') placeLinear(context, state);
  else if (type === 'snake') placeSnake(context, state);
  else if (type === 'cycle') placeCycle(context, state);
  else if (type === 'pyra') return placePyramid(context, state);
  else if (isHierarchyAlgorithm(type)) placeHierarchy(context, state);
  else {
    for (const child of childStates(context, state)) child.box = { ...box };
  }
  return true;
}
