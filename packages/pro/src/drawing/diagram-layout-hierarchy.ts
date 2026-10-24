/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Hierarchy layouts (`hierRoot`, `hierChild`) and the one-dimensional connectors that join
// their boxes.
//
// A `hierRoot` holds a node's own box and a `hierChild` with the subtrees below it. The
// outermost hierarchy node lays the whole tree out at the solved (preferred) sizes: each
// subtree's children side by side `sibSp` apart, its box `sp` above them and centred over
// the boxes of its first and last child. The tree then scales down to fit and is centred;
// the scale also applies to the connectors' bend distance.

import type { PlacementContext } from './diagram-layout-algorithms.ts';
import { presFactor, type Box, type NodeState } from './diagram-layout-solve.ts';

const HIERARCHY = new Set(['hierRoot', 'hierChild']);
/** A straight connector narrower than this keeps it as its width, centred on the line. */
const MIN_CONNECTOR_EXTENT = 91_440;

interface Placed {
  readonly state: NodeState;
  /** Position relative to the parent's frame, before scaling. */
  x: number;
  y: number;
  readonly w: number;
  readonly h: number;
  /** Centre of the subtree's own box (or its children's span), relative to this element. */
  readonly anchorX: number;
  readonly anchorY: number;
  readonly children: Placed[];
  /** The boxes the subtree draws, relative to this element: its outline for packing. */
  readonly contour: readonly Rect[];
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function shifted(rects: readonly Rect[], dx: number, dy: number): Rect[] {
  return rects.map((rect) => ({ ...rect, x: rect.x + dx, y: rect.y + dy }));
}

/**
 * How far along the row `next` must start so none of its boxes comes within `gap` of a box
 * already placed that it overlaps across the row: subtrees nest into each other's free
 * corners rather than stack by their bounding boxes.
 */
function packedOffset(
  placed: readonly Rect[],
  next: readonly Rect[],
  vertical: boolean,
  gap: number
): number {
  let offset = -Infinity;
  for (const a of placed) {
    for (const b of next) {
      const overlap = vertical
        ? Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        : Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (!(overlap > 0)) continue;
      offset = Math.max(offset, vertical ? a.y + a.h + gap - b.y : a.x + a.w + gap - b.x);
    }
  }
  return offset;
}

function childStates(context: PlacementContext, state: NodeState): NodeState[] {
  return state.node.children.map((child) => context.states[child.index]!);
}

function sizeOf(state: NodeState): { w: number; h: number } {
  return {
    w: Math.max(0, state.values.get('w') ?? 0),
    h: Math.max(0, state.values.get('h') ?? 0),
  };
}

/**
 * A `hierChild`: its subtrees side by side (`linDir` `fromL`/`fromR`) or stacked (`fromT`/
 * `fromB`), `sibSp` apart, aligned across by `chAlign`.
 */
function measureRow(context: PlacementContext, container: NodeState, depth: number): Placed {
  const roots = childStates(context, container).filter(
    (child) => child.node.algorithm.type === 'hierRoot'
  );
  const params = container.node.algorithm.params;
  const direction = params.get('linDir') ?? 'fromL';
  const vertical = direction === 'fromT' || direction === 'fromB';
  const align = params.get('chAlign') ?? (vertical ? 'l' : 't');
  const gap = container.values.get('sibSp') ?? 0;
  const items = roots.map((root) => measureRoot(context, root, depth + 1));
  let extent = 0;
  for (const item of items) extent = Math.max(extent, vertical ? item.w : item.h);
  const order = direction === 'fromR' || direction === 'fromB' ? [...items].reverse() : items;
  let contour: Rect[] = [];
  let start = 0;
  let length = 0;
  for (const [index, item] of order.entries()) {
    const size = vertical ? item.w : item.h;
    const across =
      align === 'r' || align === 'b' ? extent - size : align === 'ctr' ? (extent - size) / 2 : 0;
    const local = shifted(item.contour, vertical ? across : 0, vertical ? 0 : across);
    const at = index === 0 ? 0 : Math.max(start, packedOffset(contour, local, vertical, gap));
    start = at;
    if (vertical) {
      item.x = across;
      item.y = at;
    } else {
      item.x = at;
      item.y = across;
    }
    contour = contour.concat(shifted(local, vertical ? 0 : at, vertical ? at : 0));
    length = Math.max(length, at + (vertical ? item.h : item.w));
  }
  const first = items[0];
  const last = items[items.length - 1];
  const mid = (key: 'x' | 'y', anchor: 'anchorX' | 'anchorY') =>
    first && last ? (first[key] + first[anchor] + last[key] + last[anchor]) / 2 : 0;
  return {
    state: container,
    x: 0,
    y: 0,
    w: vertical ? extent : length,
    h: vertical ? length : extent,
    anchorX: mid('x', 'anchorX'),
    anchorY: mid('y', 'anchorY'),
    children: items,
    contour,
  };
}

/**
 * The row offset a node declares (`alignOff`). The outermost hierarchy lays out before the
 * inner nodes resolve their own constraints, so a constant is read from the definition.
 */
function alignOffset(root: NodeState): number {
  const solved = root.values.get('alignOff');
  if (solved !== undefined) return solved;
  const constraint = root.node.constraints.find(
    (entry) => entry.type === 'alignOff' && entry.for === 'self' && entry.refType === null
  );
  return constraint && Number.isFinite(constraint.val) ? constraint.val : 0;
}

/**
 * A `hierRoot`: its own box and the row of its children, placed by `hierAlign`: above
 * (`t...`, the default), below (`b...`), left (`l...`) or right (`r...`) of the row,
 * centred over the first and last child (`...CtrCh`) or flush with the row's start.
 */
function measureRoot(context: PlacementContext, root: NodeState, depth: number): Placed {
  const children = childStates(context, root);
  const own = children.find(
    (child) => !HIERARCHY.has(child.node.algorithm.type) && child.node.algorithm.type !== 'conn'
  );
  const size = own ? sizeOf(own) : { w: 0, h: 0 };
  const base = { ...size };
  // A box the user widened or heightened takes its room in the tree.
  if (own) {
    // The scale of the box itself, else the largest one set inside it.
    const factor = (name: string) => {
      let value = presFactor(own, name, NaN);
      for (const inner of childStates(context, own)) {
        const inside = presFactor(inner, name, NaN);
        if (Number.isFinite(inside))
          value = Number.isFinite(value) ? Math.max(value, inside) : inside;
      }
      return Number.isFinite(value) ? Math.min(100, Math.max(0.01, value)) : 1;
    };
    size.w *= factor('custScaleX');
    size.h *= factor('custScaleY');
  }
  const containers =
    depth > 64 ? [] : children.filter((child) => child.node.algorithm.type === 'hierChild');
  const rows = containers.map((container) => measureRow(context, container, depth));
  const row = rows.find((candidate) => candidate.children.length > 0);
  const placedOwn: Placed | null = own
    ? {
        state: own,
        x: 0,
        y: 0,
        w: base.w,
        h: base.h,
        anchorX: base.w / 2,
        anchorY: base.h / 2,
        children: [],
        contour: [],
      }
    : null;
  const parts = (): Placed[] => (placedOwn ? [placedOwn, ...rows] : rows);
  if (!row) {
    if (placedOwn) {
      placedOwn.x = (size.w - base.w) / 2;
      placedOwn.y = (size.h - base.h) / 2;
    }
    for (const empty of rows) {
      empty.x = size.w / 2;
      empty.y = size.h / 2;
    }
    return {
      state: root,
      x: 0,
      y: 0,
      w: size.w,
      h: size.h,
      anchorX: size.w / 2,
      anchorY: size.h / 2,
      children: parts(),
      contour: own ? [{ x: 0, y: 0, w: size.w, h: size.h }] : [],
    };
  }
  const gap = root.values.get('sp') ?? 0;
  const align = root.node.algorithm.params.get('hierAlign') ?? 'tCtrCh';
  const side = align[0];
  const centred = align.endsWith('CtrCh') || align.endsWith('CtrD');
  // A row flush with one edge of the box starts `alignOff` of the box in from that edge.
  const offset = centred ? 0 : Math.min(1, Math.max(0, alignOffset(root)));
  let boxX = 0;
  let boxY = 0;
  if (side === 'l' || side === 'r') {
    boxY = centred
      ? row.anchorY - size.h / 2
      : align.endsWith('B')
        ? row.h - size.h + offset * size.h
        : -offset * size.h;
    if (side === 'l') row.x = size.w + gap;
    else boxX = row.w + gap;
  } else {
    boxX = centred
      ? row.anchorX - size.w / 2
      : align.endsWith('R')
        ? row.w - size.w + offset * size.w
        : -offset * size.w;
    if (side === 'b') boxY = row.h + gap;
    else row.y = size.h + gap;
  }
  // Whichever reaches further up or left sets the origin.
  const shiftX = Math.max(0, -boxX, -row.x);
  const shiftY = Math.max(0, -boxY, -row.y);
  boxX += shiftX;
  boxY += shiftY;
  row.x += shiftX;
  row.y += shiftY;
  if (placedOwn) {
    // The box keeps its solved size in the middle of the room its user scale takes; the
    // scale itself applies when its parent places it.
    placedOwn.x = boxX + (size.w - base.w) / 2;
    placedOwn.y = boxY + (size.h - base.h) / 2;
  }
  for (const other of rows) {
    if (other === row) continue;
    other.x = boxX + size.w / 2;
    other.y = boxY + size.h;
  }
  return {
    state: root,
    x: 0,
    y: 0,
    w: Math.max(boxX + size.w, row.x + row.w),
    h: Math.max(boxY + size.h, row.y + row.h),
    anchorX: boxX + size.w / 2,
    anchorY: boxY + size.h / 2,
    children: parts(),
    contour: [
      ...(own ? [{ x: boxX, y: boxY, w: size.w, h: size.h }] : []),
      ...shifted(row.contour, row.x, row.y),
    ],
  };
}

function apply(placed: Placed, x: number, y: number, scale: number, nested: Set<NodeState>) {
  const left = x + placed.x * scale;
  const top = y + placed.y * scale;
  placed.state.box = { x: left, y: top, w: placed.w * scale, h: placed.h * scale };
  placed.state.scale = scale;
  nested.add(placed.state);
  for (const child of placed.children) apply(child, left, top, scale, nested);
}

/** Lay out a hierarchy from its outermost node; inner hierarchy nodes are already placed. */
export function placeHierarchy(context: PlacementContext, state: NodeState): void {
  const parent = state.node.parent;
  if (parent && HIERARCHY.has(parent.algorithm.type)) {
    // Scale the descendants the outer layout gave no box (the tree's connectors).
    for (const child of childStates(context, state)) {
      if (!child.box) child.scale = state.scale;
    }
    return;
  }
  const box = state.box!;
  const layout =
    state.node.algorithm.type === 'hierRoot'
      ? measureRoot(context, state, 0)
      : measureRow(context, state, 0);
  if (!(layout.w > 0) || !(layout.h > 0)) return;
  const scale = Math.min(box.w / layout.w, box.h / layout.h);
  const x = box.x + (box.w - layout.w * scale) / 2;
  const y = box.y + (box.h - layout.h * scale) / 2;
  const nested = new Set<NodeState>();
  apply({ ...layout, x: 0, y: 0 }, x, y, scale, nested);
  state.box = box;
  for (const placed of nested) {
    for (const child of childStates(context, placed)) {
      if (!child.box) child.scale = scale;
    }
  }
}

function attachPoint(box: Box, name: string): { x: number; y: number } {
  switch (name.split(/\s+/)[0]) {
    case 'tCtr':
      return { x: box.x + box.w / 2, y: box.y };
    case 'bCtr':
      return { x: box.x + box.w / 2, y: box.y + box.h };
    case 'midL':
      return { x: box.x, y: box.y + box.h / 2 };
    case 'midR':
      return { x: box.x + box.w, y: box.y + box.h / 2 };
    case 'tL':
      return { x: box.x, y: box.y };
    case 'tR':
      return { x: box.x + box.w, y: box.y };
    case 'bL':
      return { x: box.x, y: box.y + box.h };
    case 'bR':
      return { x: box.x + box.w, y: box.y + box.h };
    default:
      return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  }
}

/** The drawn node named `name` that shows content `assoc`, or the first of that name. */
function namedNode(
  context: PlacementContext,
  name: string | undefined,
  assoc: string | undefined
): NodeState | null {
  let fallback: NodeState | null = null;
  for (const state of context.states) {
    if (!state.box || (name !== undefined && state.node.name !== name)) continue;
    if (state.node.algorithm.type === 'conn') continue;
    // Without a name the end is the content's drawn shape, not a container around it.
    if (name === undefined && (state.node.shape.type === null || state.node.shape.hideGeometry))
      continue;
    if (assoc !== undefined && state.node.assoc === assoc) return state;
    if (name !== undefined) fallback ??= state;
  }
  return assoc === undefined ? fallback : null;
}

/**
 * `conn` (1D): a line from the source's attach point to the destination's, straight or
 * bent (`connRout="bend"`) at `bendDist` from the end `bendPt` names. The line is drawn as
 * a custom path in a box around it.
 */
export function placeLineConnector(context: PlacementContext, state: NodeState): void {
  const params = state.node.algorithm.params;
  const child = context.model.transitionOwner.get(state.node.assoc);
  const owner = child ? context.model.contentParent.get(child) : undefined;
  const source = namedNode(context, params.get('srcNode'), owner);
  const target = namedNode(context, params.get('dstNode'), child);
  if (!source?.box || !target?.box) {
    state.hidden = true;
    return;
  }
  const start = attachPoint(source.box, params.get('begPts') ?? 'auto');
  const end = attachPoint(target.box, params.get('endPts') ?? 'auto');
  if ((params.get('connRout') ?? 'stra') !== 'bend') {
    // A straight line is a box along it, as thick as the connector's height, turned.
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const thickness = Math.max(0, (state.values.get('h') ?? 0) * state.scale);
    const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    state.box = { x: mid.x - length / 2, y: mid.y - thickness / 2, w: length, h: thickness };
    state.rotation = (Math.atan2(end.y - start.y, end.x - start.x) * 180) / Math.PI;
    state.path = [
      { x: 0, y: thickness / 2 },
      { x: length, y: thickness / 2 },
    ];
    state.preset = null;
    state.values.set('connDist', length);
    return;
  }
  const points = [start];
  {
    const bend = (state.values.get('bendDist') ?? Math.abs(end.y - start.y) / 2) * state.scale;
    const at = params.get('bendPt') === 'beg' ? start.y + bend : end.y - bend;
    points.push({ x: start.x, y: at }, { x: end.x, y: at });
  }
  points.push(end);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (maxX - minX < MIN_CONNECTOR_EXTENT) {
    // A nearly straight drop keeps the narrow box centred on where it leaves its source.
    const mid = start.x;
    minX = mid - MIN_CONNECTOR_EXTENT / 2;
    maxX = mid + MIN_CONNECTOR_EXTENT / 2;
  }
  if (maxY - minY < MIN_CONNECTOR_EXTENT) {
    const mid = (minY + maxY) / 2;
    minY = mid - MIN_CONNECTOR_EXTENT / 2;
    maxY = mid + MIN_CONNECTOR_EXTENT / 2;
  }
  state.box = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  state.path = points.map((point) => ({ x: point.x - minX, y: point.y - minY }));
  state.preset = null;
}

export function isHierarchyAlgorithm(type: string): boolean {
  return HIERARCHY.has(type);
}
