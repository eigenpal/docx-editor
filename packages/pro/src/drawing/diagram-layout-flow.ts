/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Layout algorithms that flow children over an area: `snake` (a wrapping grid), `cycle`
// (a circle) and `pyra` (stacked levels).

import type { PlacementContext } from './diagram-layout-algorithms.ts';
import type { Box, NodeState } from './diagram-layout-solve.ts';

function childStates(context: PlacementContext, state: NodeState): NodeState[] {
  return state.node.children.map((child) => context.states[child.index]!);
}

function isTransition(state: NodeState): boolean {
  return state.node.assocType === 'sibTrans' || state.node.assocType === 'parTrans';
}

/**
 * `snake`: content children in a grid, in reading order from the start corner (`grDir`),
 * row by row (`flowDir="row"`) or column by column. The grid takes the column count that
 * makes the children largest at their solved aspect ratio, with the parent's `sp` as the
 * gap; the grid is centred, and a short last line is centred too (`off="ctr"`).
 */
export function placeSnake(context: PlacementContext, state: NodeState): void {
  const box = state.box!;
  const params = state.node.algorithm.params;
  const children = childStates(context, state);
  const nodes = children.filter((child) => !isTransition(child));
  const n = nodes.length;
  if (n === 0) return;
  const first = nodes[0]!;
  const baseW = first.values.get('w') ?? box.w;
  const baseH = first.values.get('h') ?? baseW;
  if (!(baseW > 0) || !(baseH > 0)) return;
  const ratio = baseH / baseW;
  const gapRatio = Math.max(0, (state.values.get('sp') ?? 0) / baseW);
  const byColumn = params.get('flowDir') === 'col';
  let best = { lines: 1, perLine: n, w: 0 };
  for (let perLine = 1; perLine <= n; perLine++) {
    const lines = Math.ceil(n / perLine);
    const across = byColumn ? lines : perLine;
    const down = byColumn ? perLine : lines;
    const w = Math.min(
      box.w / (across + (across - 1) * gapRatio),
      box.h / (down * ratio + (down - 1) * gapRatio)
    );
    if (w > best.w * (1 + 1e-9)) best = { lines, perLine, w };
  }
  const w = best.w;
  const h = w * ratio;
  const gap = w * gapRatio;
  const columns = byColumn ? best.lines : best.perLine;
  const rows = byColumn ? best.perLine : best.lines;
  const totalW = columns * w + (columns - 1) * gap;
  const totalH = rows * h + (rows - 1) * gap;
  const left = box.x + (box.w - totalW) / 2;
  const top = box.y + (box.h - totalH) / 2;
  const corner = params.get('grDir') ?? 'tL';
  const mirrorX = corner === 'tR' || corner === 'bR';
  const mirrorY = corner === 'bL' || corner === 'bR';
  const reverse = params.get('contDir') === 'revDir';
  const centreShort = (params.get('off') ?? 'ctr') === 'ctr';
  const places: Box[] = [];
  for (let i = 0; i < n; i++) {
    const line = Math.floor(i / best.perLine);
    let slot = i % best.perLine;
    if (reverse && line % 2 === 1) slot = best.perLine - 1 - slot;
    const inLine = Math.min(best.perLine, n - line * best.perLine);
    const shift = centreShort ? ((best.perLine - inLine) / 2) * (byColumn ? h + gap : w + gap) : 0;
    let column = byColumn ? line : slot;
    let row = byColumn ? slot : line;
    if (mirrorX) column = columns - 1 - column;
    if (mirrorY) row = rows - 1 - row;
    const x = left + column * (w + gap) + (byColumn ? 0 : mirrorX ? -shift : shift);
    const y = top + row * (h + gap) + (byColumn ? (mirrorY ? -shift : shift) : 0);
    places.push({ x, y, w, h });
  }
  nodes.forEach((node, i) => {
    node.box = places[i]!;
  });
  // A transition sits in the gap after its node, sized as solved relative to the node.
  for (const child of children) {
    if (!isTransition(child)) continue;
    const index = children.indexOf(child);
    let before: NodeState | null = null;
    for (let i = index - 1; i >= 0; i--) {
      if (!isTransition(children[i]!)) {
        before = children[i]!;
        break;
      }
    }
    const after = children.slice(index + 1).find((candidate) => !isTransition(candidate));
    if (!before?.box || !after?.box) {
      child.box = { x: box.x, y: box.y, w: 0, h: 0 };
      continue;
    }
    const scale = w / baseW;
    const tw = (child.values.get('w') ?? 0) * scale;
    const th = (child.values.get('h') ?? tw) * scale;
    const cx = (before.box.x + before.box.w / 2 + after.box.x + after.box.w / 2) / 2;
    const cy = (before.box.y + before.box.h / 2 + after.box.y + after.box.h / 2) / 2;
    child.box = { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th };
  }
}

function sizeOf(state: NodeState, fallback: number): { w: number; h: number } {
  const w = Math.max(0, state.values.get('w') ?? fallback);
  return { w, h: Math.max(0, state.values.get('h') ?? w) };
}

/**
 * `cycle`: content children on a circle from `stAng` (degrees clockwise from the top) over
 * `spanAng`. With `ctrShpMap="fNode"` the first child sits in the centre and the ring keeps
 * `sp` clear of it; neighbours on the ring keep `sibSp` between them. The whole figure is
 * then scaled to fit the box and centred. Transitions keep their solved size at the same
 * scale; their own connector algorithm places them.
 */
export function placeCycle(context: PlacementContext, state: NodeState): void {
  const box = state.box!;
  const params = state.node.algorithm.params;
  const children = childStates(context, state);
  const nodes = children.filter((child) => !isTransition(child));
  if (nodes.length === 0) return;
  const startAngle = Number(params.get('stAng') ?? '0');
  const spanAngle = Number(params.get('spanAng') ?? '360');
  const centred = params.get('ctrShpMap') === 'fNode';
  const centre = centred ? nodes[0]! : null;
  const ring = centred ? nodes.slice(1) : nodes;
  const centreSize = centre ? sizeOf(centre, box.w) : { w: 0, h: 0 };
  const sizes = ring.map((node) => sizeOf(node, box.w));
  const largest = sizes.reduce((max, size) => Math.max(max, size.w, size.h), 0);
  const m = ring.length;
  const full = Math.abs(Math.abs(spanAngle) - 360) < 1e-6;
  const step = m === 0 ? 0 : full ? spanAngle / m : m > 1 ? spanAngle / (m - 1) : 0;
  const siblingGap = state.values.get('sibSp') ?? 0;
  let radius = 0;
  if (m > 1 && Number.isFinite(step) && step !== 0) {
    const half = Math.abs((step * Math.PI) / 360);
    radius = (largest + siblingGap) / (2 * Math.sin(Math.min(half, Math.PI / 2)));
  }
  if (centre && m > 0) {
    const reach = Math.max(centreSize.w, centreSize.h) / 2 + (state.values.get('sp') ?? 0);
    radius = Math.max(radius, reach + largest / 2);
  }
  const placed = ring.map((_, i) => {
    const radians = (((startAngle + i * step) % 360) * Math.PI) / 180;
    return { x: radius * Math.sin(radians), y: -radius * Math.cos(radians) };
  });
  let minX = centre ? -centreSize.w / 2 : Infinity;
  let maxX = centre ? centreSize.w / 2 : -Infinity;
  let minY = centre ? -centreSize.h / 2 : Infinity;
  let maxY = centre ? centreSize.h / 2 : -Infinity;
  placed.forEach((point, i) => {
    const size = sizes[i]!;
    minX = Math.min(minX, point.x - size.w / 2);
    maxX = Math.max(maxX, point.x + size.w / 2);
    minY = Math.min(minY, point.y - size.h / 2);
    maxY = Math.max(maxY, point.y + size.h / 2);
  });
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!(spanX > 0) || !(spanY > 0)) return;
  const scale = Math.min(box.w / spanX, box.h / spanY);
  const originX = box.x + box.w / 2 - ((minX + maxX) / 2) * scale;
  const originY = box.y + box.h / 2 - ((minY + maxY) / 2) * scale;
  const put = (node: NodeState, x: number, y: number, size: { w: number; h: number }) => {
    const w = size.w * scale;
    const h = size.h * scale;
    node.box = { x: originX + x * scale - w / 2, y: originY + y * scale - h / 2, w, h };
  };
  if (centre) put(centre, 0, 0, centreSize);
  ring.forEach((node, i) => put(node, placed[i]!.x, placed[i]!.y, sizes[i]!));
  for (const child of children) {
    if (!isTransition(child)) continue;
    put(child, 0, 0, sizeOf(child, 0));
  }
}
