// Move, resize and delete a legacy VML text box.
//
// A VML shape keeps its geometry in its `style` attribute: `width` and `height` for the extent,
// `margin-left` and `margin-top` for the offset from the frames that
// `mso-position-horizontal-relative` and `mso-position-vertical-relative` name. A resize or a
// move rewrites exactly those entries in points and leaves every other entry, attribute and
// child as it was. Only the text box shapes the projection reads as movable take these ops;
// any other legacy drawing keeps refusing them.

import { findNode, removeNode, replaceNode, type EditOptions } from '../package/ooxml-edit.ts';
import { isLegacyVmlAtom, projectLegacyVml } from '../package/legacy-vml-projection.ts';
import { attribute, children, named, VML } from '../package/legacy-vml-values.ts';
import type { DrawingProjection } from '../package/drawing-projection.ts';
import { validateDrawingPositionInput } from '../package/drawing-position-input.ts';
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlPart } from '../package/ooxml-tree.ts';
import { fromEdit } from './tree-op-nodes.ts';
import { drawingEffect } from './tree-op-drawing-kinds.ts';
import type { DrawingTreeDocOp, TreeOpRejection, TreeOpResult } from './tree-op-types.ts';

type LegacyGeometryOp = Extract<
  DrawingTreeDocOp,
  { readonly op: 'resizeDrawing' | 'positionDrawing' | 'deleteDrawing' }
>;

/** The VML value of each reference frame a moved legacy shape can keep. */
const HORIZONTAL_FRAMES: Readonly<Record<string, string>> = {
  column: 'text',
  character: 'char',
  page: 'page',
  margin: 'margin',
  leftMargin: 'left-margin-area',
  rightMargin: 'right-margin-area',
};
const VERTICAL_FRAMES: Readonly<Record<string, string>> = {
  paragraph: 'text',
  line: 'line',
  page: 'page',
  margin: 'margin',
  topMargin: 'top-margin-area',
  bottomMargin: 'bottom-margin-area',
};

const SHAPES = new Set(['shape', 'rect', 'roundrect', 'oval']);
/** The largest extent and offset the projection reads, 10 000 pt and 100 000 pt. */
const MAX_EXTENT_EMU = 10_000 * 12700;
const MAX_OFFSET_EMU = 100_000 * 12700;

interface LegacyTextbox {
  readonly pict: OoxmlElement;
  readonly shape: OoxmlElement;
  readonly projection: DrawingProjection;
}

/** The legacy text box `drawingNodeId` names, or null when it names anything else. */
function legacyTextbox(part: OoxmlPart, drawingNodeId: string): LegacyTextbox | null {
  const pict = findNode(part, drawingNodeId);
  if (!pict || pict.kind === 'textValue' || !named(pict, WML_NAMESPACE_URI, 'pict')) return null;
  if (!isLegacyVmlAtom(pict)) return null;
  const projection = projectLegacyVml(pict, part.name);
  if (!projection?.textboxStory) return null;
  const shapes = children(pict).filter((child) => !named(child, VML, 'shapetype'));
  const shape = shapes.length === 1 ? shapes[0]! : null;
  if (!shape || shape.namespaceUri !== VML || !SHAPES.has(shape.localName)) return null;
  return { pict, shape, projection };
}

/**
 * Whether `op` targets a legacy VML drawing; such an op takes this module's path whatever
 * the outcome.
 */
export function isLegacyVmlDrawingOp(part: OoxmlPart, op: DrawingTreeDocOp): boolean {
  if (op.op !== 'resizeDrawing' && op.op !== 'positionDrawing' && op.op !== 'deleteDrawing')
    return false;
  const node = findNode(part, op.drawingNodeId);
  return !!node && node.kind !== 'textValue' && named(node, WML_NAMESPACE_URI, 'pict');
}

/** Why a legacy op is refused, or null when it applies exactly. */
export function legacyVmlGeometryRejection(
  part: OoxmlPart,
  op: LegacyGeometryOp
): TreeOpRejection | null {
  if (op.op === 'deleteDrawing' && op.revision) return 'trackedDrawingDeletionUnsupported';
  // The bounds the projection reads back, so a written shape always projects again.
  if (
    op.op === 'resizeDrawing' &&
    ![op.extentEmu.cx, op.extentEmu.cy].every(
      (emu) => Number.isFinite(emu) && emu > 0 && emu <= MAX_EXTENT_EMU
    )
  )
    return 'invalid-drawing-value';
  if (
    op.op === 'positionDrawing' &&
    (!validateDrawingPositionInput(op.position) ||
      [op.position.horizontalEmu, op.position.verticalEmu].some(
        (emu) => emu !== undefined && Math.abs(emu) > MAX_OFFSET_EMU
      ))
  )
    return 'invalid-drawing-value';
  const target = legacyTextbox(part, op.drawingNodeId);
  if (!target) return 'not-a-picture-drawing';
  const { locks, kind } = target.projection;
  if (op.op === 'deleteDrawing') return locks.select ? 'drawing-locked' : null;
  if (op.op === 'resizeDrawing') return locks.resize ? 'drawing-locked' : null;
  if (locks.move) return 'drawing-locked';
  if (kind !== 'anchored' || op.position.mode !== 'frame') return 'invalid-drawing-value';
  if (op.position.relativeToH !== undefined && !(op.position.relativeToH in HORIZONTAL_FRAMES))
    return 'invalid-drawing-value';
  if (op.position.relativeToV !== undefined && !(op.position.relativeToV in VERTICAL_FRAMES))
    return 'invalid-drawing-value';
  return null;
}

/** Points written for EMU, to the hundredth. */
const pointsOf = (emu: number): string => `${Math.round((emu / 12700) * 100) / 100}pt`;

/** `style` with `set` entries written in place (or appended) and `drop` entries removed. */
function restyled(
  style: string,
  set: ReadonlyMap<string, string>,
  drop: ReadonlySet<string>
): string {
  const written = new Set<string>();
  const entries: string[] = [];
  for (const entry of style.split(';')) {
    const colon = entry.indexOf(':');
    if (colon < 1) continue;
    const key = entry.slice(0, colon).trim().toLowerCase();
    if (drop.has(key)) continue;
    const value = set.get(key);
    entries.push(value === undefined ? entry.trim() : `${key}:${value}`);
    if (value !== undefined) written.add(key);
  }
  for (const [key, value] of set) if (!written.has(key)) entries.push(`${key}:${value}`);
  return entries.join(';');
}

/** Apply a legacy op that {@link legacyVmlGeometryRejection} accepted. */
export function applyLegacyVmlGeometryOp(
  part: OoxmlPart,
  op: LegacyGeometryOp,
  options?: EditOptions
): TreeOpResult {
  const rejection = legacyVmlGeometryRejection(part, op);
  if (rejection) return { ok: false, reason: rejection };
  const { pict, shape } = legacyTextbox(part, op.drawingNodeId)!;
  if (op.op === 'deleteDrawing') {
    const effect = drawingEffect(part, pict.id, op);
    return fromEdit(removeNode(part, pict.id, options), { ...effect, deleted: [pict.id] });
  }
  const set = new Map<string, string>();
  const drop = new Set<string>();
  if (op.op === 'resizeDrawing') {
    set.set('width', pointsOf(op.extentEmu.cx));
    set.set('height', pointsOf(op.extentEmu.cy));
  } else {
    const { horizontalEmu, verticalEmu, relativeToH, relativeToV } = op.position;
    // An offset replaces an alignment, as a modern drawing's `wp:posOffset` replaces `wp:align`.
    if (horizontalEmu !== undefined) {
      set.set('margin-left', pointsOf(horizontalEmu));
      drop.add('mso-position-horizontal').add('left');
    }
    if (verticalEmu !== undefined) {
      set.set('margin-top', pointsOf(verticalEmu));
      drop.add('mso-position-vertical').add('top');
    }
    if (relativeToH !== undefined)
      set.set('mso-position-horizontal-relative', HORIZONTAL_FRAMES[relativeToH]!);
    if (relativeToV !== undefined)
      set.set('mso-position-vertical-relative', VERTICAL_FRAMES[relativeToV]!);
  }
  // A shape the projection reads has a `style`: its extent comes from it.
  const style = restyled(attribute(shape, 'style')!, set, drop);
  const attributes = shape.attributes.map((a) =>
    !a.namespaceUri && a.localName === 'style' ? { ...a, value: style } : a
  );
  const updatedShape = { ...shape, attributes } as OoxmlElement;
  const updatedPict = {
    ...pict,
    children: pict.children.map((child) => (child.id === shape.id ? updatedShape : child)),
  } as OoxmlElement;
  return fromEdit(
    replaceNode(part, pict.id, updatedPict, options),
    drawingEffect(part, pict.id, op)
  );
}
