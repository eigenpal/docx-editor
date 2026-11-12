// `setShapeFill` and `setShapeOutline`: the fill and outline of the selected shape, text box,
// line or group, as one `setShapeFormat` op and so one undo step.
//
// `can` runs the same validation the op runs against the current part, so a command `can`
// admits applies, and one it refuses names the reason: no selection, a stale one, a drawing
// with no fill to set, or a value the op cannot write exactly.

import type {
  EditorCommand,
  ExecResult,
  SetShapeFillCommand,
  SetShapeOutlineCommand,
} from '../contracts/editor.ts';
import { validateShapeFormat } from '../store/store/tree-op-shape-format.ts';
import type { DrawingTreeDocOp, TreeOpRejection } from '../store/store/tree-op-types.ts';
import { commandProtectionRefusal } from './command-protection.ts';
import { selectedImageStateOf } from './docx-editor-images.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { partOfNodeId } from './surface-scope.ts';
import { shapeColorHex } from '../store/package/shape-format.ts';

type ShapeFormatCommand = Extract<EditorCommand, { type: 'setShapeFill' | 'setShapeOutline' }>;
type SetShapeFormatOp = Extract<DrawingTreeDocOp, { op: 'setShapeFormat' }>;
type Refusal = Exclude<ExecResult, { ok: true }>;

export function isShapeFormatCommand(command: EditorCommand): command is ShapeFormatCommand {
  return command.type === 'setShapeFill' || command.type === 'setShapeOutline';
}

/** `RRGGBB` from `RRGGBB`, `#RRGGBB` or a CSS colour name; anything else stays for the op to refuse. */
function hexOf(color: unknown): string | undefined {
  if (color === undefined) return undefined;
  return typeof color === 'string' ? (shapeColorHex(color) ?? color) : String(color);
}

function fillOf(command: SetShapeFillCommand): SetShapeFormatOp['fill'] | Refusal {
  const { visible, color, transparency } = command;
  if (visible === undefined && color === undefined && transparency === undefined)
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'setShapeFill needs visible, color or transparency',
    };
  if (visible === false) {
    if (color !== undefined || transparency !== undefined)
      return { ok: false, code: 'invalidArgs', reason: 'a hidden fill takes no color' };
    return { type: 'none' };
  }
  return {
    type: 'solid',
    ...(color !== undefined ? { color: hexOf(color) } : {}),
    ...(transparency !== undefined ? { transparency } : {}),
  };
}

function outlineOf(command: SetShapeOutlineCommand): SetShapeFormatOp['outline'] {
  const { visible, color, widthPt } = command;
  return {
    ...(visible !== undefined ? { visible } : {}),
    ...(color !== undefined ? { color: hexOf(color) } : {}),
    ...(widthPt !== undefined ? { widthPt } : {}),
  };
}

const REASONS: Partial<Record<TreeOpRejection, string>> = {
  'invalid-drawing-value': 'the fill or outline value is out of range',
  'unsupported-property': 'a legacy shape has no transparency',
  'no-solid-fill': 'the shape has no solid fill to change; set a color',
  'not-a-shape-drawing': 'this drawing has no fill or outline to set',
  'unknown-drawing': 'stale drawing selection',
};

function refusalOf(reason: TreeOpRejection | string): Refusal {
  const known = REASONS[reason as TreeOpRejection];
  return {
    ok: false,
    code: reason === 'not-a-shape-drawing' ? 'unsupported' : 'invalidArgs',
    reason: known ?? reason,
  };
}

/** The op a shape format command writes, or why it is refused. */
function planCommand(command: ShapeFormatCommand, surface: PaginatedSurface | null) {
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' } as const;
  const protectedWrite = commandProtectionRefusal(command, surface);
  if (protectedWrite) return protectedWrite;
  const selected = selectedImageStateOf(surface);
  if (!selected) return { ok: false, code: 'notFound', reason: 'no drawing is selected' } as const;
  if (command.drawingNodeId !== undefined && command.drawingNodeId !== selected.id)
    return { ok: false, code: 'notFound', reason: 'stale drawing selection' } as const;
  if (!selected.shapeFormat) return refusalOf('not-a-shape-drawing');
  let op: SetShapeFormatOp;
  if (command.type === 'setShapeFill') {
    const fill = fillOf(command);
    if (fill && 'ok' in fill) return fill;
    op = { op: 'setShapeFormat', drawingNodeId: selected.id, fill };
  } else {
    op = { op: 'setShapeFormat', drawingNodeId: selected.id, outline: outlineOf(command) };
  }
  const part = partOfNodeId(surface.session, selected.id) ?? surface.session.part();
  const rejection = validateShapeFormat(part, op);
  return rejection ? refusalOf(rejection) : op;
}

/** The refusal `can` reports for a shape format command, or null when it applies. */
export function gateShapeFormatCommand(
  command: EditorCommand,
  surface: PaginatedSurface | null
): Refusal | null {
  if (!isShapeFormatCommand(command)) return null;
  const planned = planCommand(command, surface);
  return 'ok' in planned ? planned : null;
}

/** Apply a shape format command as one undo step; null when it committed. */
export function execShapeFormatCommand(
  surface: PaginatedSurface,
  command: ShapeFormatCommand
): ExecResult | null {
  const planned = planCommand(command, surface);
  if ('ok' in planned) return planned;
  const result = surface.applyDrawingOps([planned]);
  if (result.rejected)
    return refusalOf(typeof result.reason === 'string' ? result.reason : 'the change was refused');
  return null;
}
