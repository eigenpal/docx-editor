// Selected-image derivation and image command dispatch for `createDocxEditor` (task 13).
//
// Reads derive from layout records plus canonical projection; writes route through the
// surface guarded mutation path — never raw session bypass.

import type {
  CanResult,
  EditorCommand,
  ExecResult,
  ImageContext,
  SelectedImageState,
} from '../contracts/editor.ts';
import { lineAtPosition } from '../layout/index.ts';
import { lineAtIndexedPosition } from '../layout/paragraph-lines.ts';
import type { AnchoredDrawingRecord, InlineDrawingRecord } from '../layout/drawing-layout.ts';
import { findDrawingOverlayFrameInLayout } from '../layout/semantic-hit-test.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import type {
  DrawingPositionInput,
  DrawingTransform,
} from '../store/package/drawing-projection.ts';
import {
  createDrawingRelationshipResolver,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  projectDrawing,
  type DrawingProjection,
  type ImageWrapTarget,
} from '../store/package/drawing-projection.ts';
import {
  cropPercentFromSourceCrop,
  cropPermilleFromCropPercent,
  validateImageCropPercent,
} from '../store/package/image-crop-units.ts';
import { sanitizeHref } from '../store/package/sinks.ts';
import type { SupportedImageMime } from '../store/package/image-resources.ts';
import {
  validateDrawingPositionInput,
  validateSetImagePositionCommand,
  propertiesCommandHasPositionFields,
  positionInputFromPropertiesCommand,
} from '../store/package/drawing-position-input.ts';
import type { DrawingTreeDocOp } from '../store/store/tree-op-types.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';

export type { ImageContext, SelectedImageState };

type SelectedDrawingRecord = InlineDrawingRecord | AnchoredDrawingRecord;

const IMAGE_ASYNC_COMMAND_TYPES = new Set(['insertImage', 'replaceImage']);
const IMAGE_COMMAND_TYPES = new Set([
  'insertImage',
  'replaceImage',
  'deleteImage',
  'setImageWrapType',
  'transformImage',
  'setImagePosition',
  'setImageProperties',
]);

export type ImageMutationPreconditions = Readonly<{
  mountGeneration: number;
  packageRevision: number;
  drawingNodeId: string | null;
  selectionParagraphId: string;
  selectionOffset: number;
}>;

function inlineDrawingAtOffset(
  line: ReturnType<typeof lineAtPosition>,
  paragraphId: string,
  offset: number
): InlineDrawingRecord | null {
  if (!line) return null;
  for (const drawing of line.drawings ?? []) {
    // The PARAGRAPH as well as the offset. A resolved display mode draws two paragraphs on
    // the join line and both count from zero, so an offset alone selected the other half's
    // image — and every later command addressed that one.
    if (drawing.paragraphId !== paragraphId) continue;
    if (drawing.start === offset || drawing.start + 1 === offset) return drawing;
  }
  return null;
}

function anchoredDrawingAtSelection(
  surface: PaginatedSurface,
  paragraphId: string,
  offset: number
): AnchoredDrawingRecord | null {
  const layout = surface.layout();
  for (const page of layout.pages) {
    for (const drawing of page.anchoredDrawings ?? []) {
      if (
        drawing.anchorParagraphId === paragraphId &&
        (drawing.start === offset || drawing.start + 1 === offset)
      ) {
        return drawing;
      }
    }
    for (const story of [page.header, page.footer]) {
      if (!story) continue;
      for (const drawing of story.anchoredDrawings ?? []) {
        if (
          drawing.anchorParagraphId === paragraphId &&
          (drawing.start === offset || drawing.start + 1 === offset)
        ) {
          return drawing;
        }
      }
    }
  }
  return null;
}

/**
 * Comparable key for a drawing-selection intent, so a state guard can watch its transitions
 * — including a press on the drawing at offsets the selection already holds.
 */
export function drawingSelectionIntentKey(
  intent: import('./paginated-surface-contract.ts').DrawingSelectionIntent
): string {
  return intent.kind === 'pointer' ? `pointer:${intent.drawingNodeId}` : intent.kind;
}

export function resolveSelectedDrawingRecord(
  surface: PaginatedSurface | null
): SelectedDrawingRecord | null {
  if (!surface) return null;
  // Word's rule: a caret at a drawing's anchor offset is a TEXT caret unless something
  // selected the object — a pointer press on the painted drawing, or an explicit host
  // selection write. The mount-time caret routinely coincides with a drawing anchored at
  // offset zero, and typing lands the caret at anchor+1; neither means "selected".
  const intent = surface.drawingSelectionIntent();
  if (intent.kind === 'none') return null;
  const { anchor, head } = surface.state().selection;
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return null;
  const line = lineAtIndexedPosition(surface.layout(), anchor.paragraphId, anchor.offset);
  const record =
    inlineDrawingAtOffset(line, anchor.paragraphId, anchor.offset) ??
    anchoredDrawingAtSelection(surface, anchor.paragraphId, anchor.offset);
  if (!record) return null;
  // A pointer press names its drawing, so a stale press can never claim a DIFFERENT
  // drawing the caret later visits (a find jump that lands at another anchor).
  if (intent.kind === 'pointer' && record.drawingNodeId !== intent.drawingNodeId) return null;
  return record;
}

function projectDrawingForRecord(
  surface: PaginatedSurface,
  record: SelectedDrawingRecord
): DrawingProjection | null {
  const scope = surface.storyScope();
  const part = surface.session.partFor(scope) ?? surface.session.part();
  const drawing = findNode(part, record.drawingNodeId);
  if (!drawing || drawing.kind !== 'drawing') return null;
  return projectDrawing(drawing as import('../store/package/ooxml-tree.ts').OoxmlDrawingNode, {
    ownerPartName: record.ownerPartName,
    supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    resolveRelationship: createDrawingRelationshipResolver(
      surface.session.currentPackage(),
      record.ownerPartName
    ),
  });
}

function positionInputOf(projection: DrawingProjection): DrawingPositionInput | null {
  if (projection.kind !== 'anchored' || !projection.position) return null;
  const pos = projection.position;
  if (projection.anchor?.simplePos) {
    return Object.freeze({
      mode: 'simple' as const,
      horizontalEmu: pos.simplePosition.xEmu,
      verticalEmu: pos.simplePosition.yEmu,
    });
  }
  return Object.freeze({
    mode: 'frame' as const,
    ...(pos.horizontal.offsetEmu !== null ? { horizontalEmu: pos.horizontal.offsetEmu } : {}),
    ...(pos.vertical.offsetEmu !== null ? { verticalEmu: pos.vertical.offsetEmu } : {}),
    relativeToH: pos.horizontal.relativeFrom,
    relativeToV: pos.vertical.relativeFrom,
  });
}

function intrinsicOf(record: SelectedDrawingRecord): SelectedImageState['intrinsic'] {
  const resource = record.resource;
  if (resource.kind !== 'ready') return null;
  return Object.freeze({
    pixelWidth: resource.pixelWidth,
    pixelHeight: resource.pixelHeight,
    dpiX: resource.dpiX,
    dpiY: resource.dpiY,
  });
}

function capabilityFlags(
  projection: DrawingProjection
): Pick<SelectedImageState, 'canResize' | 'canMove' | 'canChangeWrap' | 'canCrop'> {
  const locks = projection.locks;
  return Object.freeze({
    canResize: !locks.resize && !projection.hidden,
    canMove: !locks.move && !projection.hidden,
    canChangeWrap: !locks.move && projection.kind === 'anchored' && !projection.hidden,
    canCrop: !locks.resize && !locks.changeAspect && !projection.hidden,
  });
}

function wrapOf(record: SelectedDrawingRecord): ImageWrapTarget {
  if (record.kind === 'inlineDrawing') return 'inline';
  return record.wrap;
}

/**
 * The selected image and what may be done to it, or null when nothing image-like is selected.
 *
 * Null covers more than "no selection": a placeholder graphic, a drawing the file marks hidden,
 * and one whose `select` lock is set all read as no selection, because chrome that offered
 * resize handles on them would promise an edit the store is about to refuse.
 */
export function selectedImageStateOf(surface: PaginatedSurface | null): SelectedImageState | null {
  const record = resolveSelectedDrawingRecord(surface);
  if (!record) return null;
  if (record.placeholderGraphicKind !== null) return null;
  const projection = surface ? projectDrawingForRecord(surface, record) : null;
  if (!projection) return null;
  if (projection.hidden || projection.locks.select) return null;
  const transform = record.transform;
  return Object.freeze({
    id: record.drawingNodeId,
    kind: projection.kind,
    widthEmu: projection.extentEmu.cx,
    heightEmu: projection.extentEmu.cy,
    crop: cropPercentFromSourceCrop(record.crop),
    rotationDegrees: transform.rotationDegrees,
    wrap: wrapOf(record),
    position: positionInputOf(projection),
    name: projection.name,
    title: projection.title,
    description: projection.description,
    hyperlink: projection.hyperlinkHref,
    locks: projection.locks,
    hidden: projection.hidden,
    resourceStatus: record.resource.kind,
    intrinsic: intrinsicOf(record),
    ...capabilityFlags(projection),
  });
}

export function imageContextEqual(
  a: SelectedImageState | null,
  b: SelectedImageState | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.widthEmu === b.widthEmu &&
    a.heightEmu === b.heightEmu &&
    a.crop.left === b.crop.left &&
    a.crop.top === b.crop.top &&
    a.crop.right === b.crop.right &&
    a.crop.bottom === b.crop.bottom &&
    a.rotationDegrees === b.rotationDegrees &&
    a.wrap === b.wrap &&
    a.name === b.name &&
    a.title === b.title &&
    a.description === b.description &&
    a.hyperlink === b.hyperlink &&
    a.hidden === b.hidden &&
    a.resourceStatus === b.resourceStatus &&
    a.canResize === b.canResize &&
    a.canMove === b.canMove &&
    a.canChangeWrap === b.canChangeWrap &&
    a.canCrop === b.canCrop &&
    a.locks.select === b.locks.select &&
    a.locks.move === b.locks.move &&
    a.locks.resize === b.locks.resize &&
    a.locks.changeAspect === b.locks.changeAspect &&
    (a.position?.mode ?? 'frame') === (b.position?.mode ?? 'frame') &&
    (a.position?.horizontalEmu ?? null) === (b.position?.horizontalEmu ?? null) &&
    (a.position?.verticalEmu ?? null) === (b.position?.verticalEmu ?? null) &&
    (a.position?.relativeToH ?? null) === (b.position?.relativeToH ?? null) &&
    (a.position?.relativeToV ?? null) === (b.position?.relativeToV ?? null) &&
    (a.intrinsic?.pixelWidth ?? null) === (b.intrinsic?.pixelWidth ?? null) &&
    (a.intrinsic?.pixelHeight ?? null) === (b.intrinsic?.pixelHeight ?? null) &&
    (a.intrinsic?.dpiX ?? null) === (b.intrinsic?.dpiX ?? null) &&
    (a.intrinsic?.dpiY ?? null) === (b.intrinsic?.dpiY ?? null)
  );
}

function requestedDrawingId(command: EditorCommand): string | undefined {
  if (
    'drawingNodeId' in command &&
    typeof (command as { drawingNodeId?: unknown }).drawingNodeId === 'string'
  ) {
    return (command as { drawingNodeId: string }).drawingNodeId;
  }
  return undefined;
}

function expectedPackageRevisionOf(command: EditorCommand): number | undefined {
  if (
    'expectedPackageRevision' in command &&
    typeof (command as { expectedPackageRevision?: unknown }).expectedPackageRevision === 'number'
  ) {
    return (command as { expectedPackageRevision: number }).expectedPackageRevision;
  }
  return undefined;
}

export function imageCommandHasIdentityFields(command: EditorCommand): boolean {
  return (
    requestedDrawingId(command) !== undefined ||
    expectedPackageRevisionOf(command) !== undefined ||
    (command.type === 'setImageProperties' && command.selectionParagraphId !== undefined)
  );
}

export function verifyImageCommandIdentity(
  editor: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>,
  command: EditorCommand,
  pre: ImageMutationPreconditions
): ExecResult | null {
  const surface = editor.surface;
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  const expectedRevision = expectedPackageRevisionOf(command);
  if (expectedRevision !== undefined && surface.session.packageRevision() !== expectedRevision) {
    return { ok: false, code: 'notFound', reason: 'stale package revision' };
  }
  const requested = requestedDrawingId(command);
  const selected = selectedImageStateOf(surface);
  if (requested !== undefined && (!selected || selected.id !== requested)) {
    return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
  }
  if (
    command.type === 'setImageProperties' &&
    command.selectionParagraphId !== undefined &&
    command.selectionOffset !== undefined
  ) {
    const { anchor, head } = surface.state().selection;
    if (
      anchor.paragraphId !== command.selectionParagraphId ||
      anchor.offset !== command.selectionOffset ||
      head.paragraphId !== command.selectionParagraphId ||
      head.offset !== command.selectionOffset
    ) {
      return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
    }
  }
  return isStaleImageMutation(editor, pre, {
    requireDrawing: requested !== undefined || pre.drawingNodeId !== null,
    drawingNodeId: requested ?? pre.drawingNodeId ?? undefined,
  });
}

function selectedOrRequestedId(
  surface: PaginatedSurface,
  command: EditorCommand
): { readonly id: string } | ExecResult {
  const selected = selectedImageStateOf(surface);
  const requested = requestedDrawingId(command);
  if (requested) {
    if (!selected || selected.id !== requested) {
      return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
    }
    return { id: requested };
  }
  if (!selected) {
    return { ok: false, code: 'notFound', reason: 'no drawing is selected' };
  }
  return { id: selected.id };
}

function drawingOpsResult(
  result: ReturnType<PaginatedSurface['applyDrawingOps']>
): ExecResult | null {
  if (result.rejected) {
    const reason =
      result.reason === 'drawing-locked'
        ? 'the drawing is locked'
        : result.reason === 'unknown-drawing'
          ? 'stale drawing selection'
          : typeof result.reason === 'string'
            ? result.reason
            : 'the image change was refused';
    return { ok: false, code: 'invalidArgs', reason };
  }
  return null;
}

function applyDrawingOps(
  surface: PaginatedSurface,
  ops: readonly DrawingTreeDocOp[]
): ExecResult | null {
  return drawingOpsResult(surface.applyDrawingOps(ops));
}

function naturalExtentEmu(
  image: SelectedImageState
): { readonly cx: number; readonly cy: number } | null {
  if (!image.intrinsic) return null;
  const cx = Math.round((image.intrinsic.pixelWidth * 914_400) / image.intrinsic.dpiX);
  const cy = Math.round((image.intrinsic.pixelHeight * 914_400) / image.intrinsic.dpiY);
  if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return null;
  return { cx, cy };
}

function hasBorderPayload(
  command: Extract<EditorCommand, { type: 'setImageProperties' }>
): boolean {
  return command.borderWidthEmu !== undefined || command.borderColor !== undefined;
}

function positionCommandHasFields(
  command: Extract<EditorCommand, { type: 'setImagePosition' }>
): boolean {
  return (
    command.horizontalEmu !== undefined ||
    command.verticalEmu !== undefined ||
    command.relativeToH !== undefined ||
    command.relativeToV !== undefined
  );
}

function propertiesCommandHasFields(
  command: Extract<EditorCommand, { type: 'setImageProperties' }>
): boolean {
  return (
    command.widthEmu !== undefined ||
    command.heightEmu !== undefined ||
    command.alt !== undefined ||
    command.title !== undefined ||
    command.description !== undefined ||
    command.hyperlink !== undefined ||
    command.crop !== undefined ||
    command.wrap !== undefined ||
    command.resetToNaturalSize === true ||
    propertiesCommandHasPositionFields(command)
  );
}

function positionInputFromCommand(
  command: Extract<EditorCommand, { type: 'setImagePosition' }>,
  selected: SelectedImageState | null
): DrawingPositionInput {
  if (selected?.position?.mode === 'simple') {
    return Object.freeze({
      mode: 'simple' as const,
      ...(command.horizontalEmu !== undefined ? { horizontalEmu: command.horizontalEmu } : {}),
      ...(command.verticalEmu !== undefined ? { verticalEmu: command.verticalEmu } : {}),
    });
  }
  return Object.freeze({
    mode: 'frame' as const,
    ...(command.horizontalEmu !== undefined ? { horizontalEmu: command.horizontalEmu } : {}),
    ...(command.verticalEmu !== undefined ? { verticalEmu: command.verticalEmu } : {}),
    ...(command.relativeToH !== undefined
      ? { relativeToH: command.relativeToH as DrawingPositionInput['relativeToH'] }
      : {}),
    ...(command.relativeToV !== undefined
      ? { relativeToV: command.relativeToV as DrawingPositionInput['relativeToV'] }
      : {}),
  });
}

export function isImageCommand(command: EditorCommand): boolean {
  return IMAGE_COMMAND_TYPES.has(command.type);
}

export function isAsyncImageCommand(
  command: EditorCommand
): command is Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }> {
  return IMAGE_ASYNC_COMMAND_TYPES.has(command.type);
}

export function asyncImageCommandRefusal(
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>
): ExecResult {
  return {
    ok: false,
    code: 'unsupported',
    reason: `${command.type} is asynchronous; use executeImageCommand`,
  };
}

function asyncImageExecutionGate(surface: PaginatedSurface | null): ExecResult | null {
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  const mode = surface.editingMode();
  if (mode === 'view') {
    return { ok: false, code: 'locked', reason: 'the document is open for viewing' };
  }
  if (mode === 'suggest') {
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'image property edits are not supported in suggesting mode',
    };
  }
  return null;
}

/**
 * Snapshot the state an image mutation was planned against: mount generation, package revision,
 * and the selection anchor.
 *
 * Taken at the START of a drag so the commit can be checked against it with
 * {@link isStaleImageInteractionCommit}. A pointer gesture spans many frames, and a document that
 * moved underneath it must not have the gesture's final coordinates applied to it.
 */
export function captureImageMutationPreconditions(
  editor: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>
): ImageMutationPreconditions | null {
  const surface = editor.surface;
  if (!surface) return null;
  const { anchor } = surface.state().selection;
  const selected = selectedImageStateOf(surface);
  return Object.freeze({
    mountGeneration: editor.mountGeneration,
    packageRevision: surface.session.packageRevision(),
    drawingNodeId: selected?.id ?? null,
    selectionParagraphId: anchor.paragraphId,
    selectionOffset: anchor.offset,
  });
}

function isStaleImageMutation(
  editor: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>,
  pre: ImageMutationPreconditions,
  options?: { readonly requireDrawing?: boolean; readonly drawingNodeId?: string }
): ExecResult | null {
  const surface = editor.surface;
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  if (editor.mountGeneration !== pre.mountGeneration) {
    return { ok: false, code: 'notFound', reason: 'the editor is no longer attached' };
  }
  const { anchor, head } = surface.state().selection;
  if (anchor.paragraphId !== pre.selectionParagraphId || anchor.offset !== pre.selectionOffset) {
    return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
  }
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) {
    return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
  }
  if (options?.requireDrawing) {
    const selected = selectedImageStateOf(surface);
    const expectedId = options.drawingNodeId ?? pre.drawingNodeId;
    if (!selected || !expectedId || selected.id !== expectedId) {
      return { ok: false, code: 'notFound', reason: 'stale drawing selection' };
    }
  }
  return null;
}

export function gateImageCommand(
  command: EditorCommand,
  surface: PaginatedSurface | null
): ExecResult | null {
  if (!isImageCommand(command)) return null;
  if (!surface) {
    return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  }
  if (command.type === 'insertImage') {
    if (!(command.data instanceof Uint8Array) || command.data.byteLength === 0) {
      return { ok: false, code: 'invalidArgs', reason: 'insertImage requires image bytes' };
    }
    if (!Number.isFinite(command.widthPoints) || !Number.isFinite(command.heightPoints)) {
      return { ok: false, code: 'invalidArgs', reason: 'insertImage requires finite dimensions' };
    }
    if (command.widthPoints <= 0 || command.heightPoints <= 0) {
      return { ok: false, code: 'invalidArgs', reason: 'insertImage dimensions must be positive' };
    }
    return null;
  }
  if (command.type === 'replaceImage') {
    if (!(command.data instanceof Uint8Array) || command.data.byteLength === 0) {
      return { ok: false, code: 'invalidArgs', reason: 'replaceImage requires image bytes' };
    }
    const resolved = selectedOrRequestedId(surface, command);
    if ('ok' in resolved) return resolved;
    return null;
  }
  const resolved = selectedOrRequestedId(surface, command);
  if ('ok' in resolved) return resolved;
  const image = selectedImageStateOf(surface);
  if (!image) {
    return { ok: false, code: 'notFound', reason: 'no drawing is selected' };
  }
  if (surface.editingMode() === 'suggest') {
    if (command.type === 'deleteImage') {
      return {
        ok: false,
        code: 'invalidArgs',
        reason: 'trackedDrawingDeletionUnsupported',
      };
    }
    return {
      ok: false,
      code: 'invalidArgs',
      reason: 'image property edits are not supported in suggesting mode',
    };
  }
  switch (command.type) {
    case 'deleteImage':
      if (image.locks.select) {
        return { ok: false, code: 'locked', reason: 'the drawing cannot be selected' };
      }
      return null;
    case 'setImageWrapType': {
      if (!image.canChangeWrap) {
        return { ok: false, code: 'locked', reason: 'wrap cannot be changed on this drawing' };
      }
      return null;
    }
    case 'transformImage':
      if (image.locks.changeAspect || image.locks.resize) {
        return { ok: false, code: 'locked', reason: 'the drawing is locked' };
      }
      return null;
    case 'setImagePosition':
      if (!image.canMove || image.kind !== 'anchored') {
        return { ok: false, code: 'locked', reason: 'position cannot be changed on this drawing' };
      }
      if (!positionCommandHasFields(command)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImagePosition requires at least one field',
        };
      }
      const positionMode = image.position?.mode ?? 'frame';
      if (!validateSetImagePositionCommand(command, positionMode)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImagePosition carries invalid position values',
        };
      }
      if (!validateDrawingPositionInput(positionInputFromCommand(command, image))) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImagePosition carries invalid position values',
        };
      }
      return null;
    case 'setImageProperties': {
      if (hasBorderPayload(command)) {
        return {
          ok: false,
          code: 'unsupported',
          reason: 'image border properties are not supported yet',
        };
      }
      if (!propertiesCommandHasFields(command)) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImageProperties requires at least one field',
        };
      }
      if (command.resetToNaturalSize && !image.intrinsic) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'natural size is unavailable for this image',
        };
      }
      if (
        command.widthEmu !== undefined &&
        (!Number.isFinite(command.widthEmu) || command.widthEmu <= 0)
      ) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'widthEmu must be a positive finite number',
        };
      }
      if (
        command.heightEmu !== undefined &&
        (!Number.isFinite(command.heightEmu) || command.heightEmu <= 0)
      ) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'heightEmu must be a positive finite number',
        };
      }
      if (command.widthEmu !== undefined && !image.canResize) {
        return { ok: false, code: 'locked', reason: 'the drawing is locked' };
      }
      if (command.heightEmu !== undefined && !image.canResize) {
        return { ok: false, code: 'locked', reason: 'the drawing is locked' };
      }
      if (command.crop !== undefined && !validateImageCropPercent(command.crop)) {
        return { ok: false, code: 'invalidArgs', reason: 'crop values are out of range' };
      }
      if (command.crop !== undefined && !image.canCrop) {
        return { ok: false, code: 'locked', reason: 'crop cannot be changed on this drawing' };
      }
      if (command.hyperlink !== undefined && command.hyperlink !== null) {
        const href = sanitizeHref(command.hyperlink);
        if (!href.ok) {
          return { ok: false, code: 'invalidArgs', reason: 'unsafe hyperlink URL' };
        }
      }
      if (command.wrap !== undefined && !image.canChangeWrap) {
        return { ok: false, code: 'locked', reason: 'wrap cannot be changed on this drawing' };
      }
      if (propertiesCommandHasPositionFields(command)) {
        if (!image.canMove || image.kind !== 'anchored') {
          return {
            ok: false,
            code: 'locked',
            reason: 'position cannot be changed on this drawing',
          };
        }
        const positionMode = image.position?.mode ?? 'frame';
        if (!validateSetImagePositionCommand(command, positionMode)) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: 'setImageProperties carries invalid position values',
          };
        }
        if (!validateDrawingPositionInput(positionInputFromPropertiesCommand(command, image))) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: 'setImageProperties carries invalid position values',
          };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Whether an insert or replace would be accepted — the `can` half of the can-before-exec pair.
 *
 * Refuses in suggesting mode, since an image property edit has no tracked-change representation.
 */
export function canExecuteImageCommand(
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>,
  surface: PaginatedSurface | null
): CanResult {
  const modeGate = asyncImageExecutionGate(surface);
  if (modeGate) return modeGate;
  const gate = gateImageCommand(command, surface);
  if (gate) return gate;
  return { ok: true };
}

export function canAsyncImageCommand(
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>,
  surface: PaginatedSurface | null
): CanResult {
  const gate = gateImageCommand(command, surface);
  if (gate) return gate;
  return asyncImageCommandRefusal(command);
}

export function execImageCommand(
  surface: PaginatedSurface,
  command: EditorCommand,
  editor?: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>
): ExecResult | null {
  if (isAsyncImageCommand(command)) {
    return asyncImageCommandRefusal(command);
  }
  const pre =
    editor && imageCommandHasIdentityFields(command)
      ? captureImageMutationPreconditions(editor)
      : null;
  if (pre && editor) {
    const identity = verifyImageCommandIdentity(editor, command, pre);
    if (identity) return identity;
  }
  switch (command.type) {
    case 'deleteImage': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      const result = surface.deleteImage(resolved.id);
      if (!result.ok) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: result.detail ?? result.reason ?? 'deleteImage was refused',
        };
      }
      return null;
    }
    case 'setImageWrapType': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      return applyDrawingOps(surface, [
        { op: 'setDrawingWrap', drawingNodeId: resolved.id, wrap: command.target },
      ]);
    }
    case 'transformImage': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      return applyDrawingOps(surface, [
        { op: 'transformDrawing', drawingNodeId: resolved.id, action: command.action },
      ]);
    }
    case 'setImagePosition': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      const selected = selectedImageStateOf(surface);
      const position = positionInputFromCommand(command, selected);
      return applyDrawingOps(surface, [
        { op: 'positionDrawing', drawingNodeId: resolved.id, position },
      ]);
    }
    case 'setImageProperties': {
      const resolved = selectedOrRequestedId(surface, command);
      if ('ok' in resolved) return resolved;
      const image = selectedImageStateOf(surface);
      if (!image) return { ok: false, code: 'notFound', reason: 'no drawing is selected' };
      const ops: DrawingTreeDocOp[] = [];
      if (command.resetToNaturalSize) {
        const natural = naturalExtentEmu(image);
        if (!natural) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: 'natural size is unavailable for this image',
          };
        }
        ops.push({ op: 'resizeDrawing', drawingNodeId: resolved.id, extentEmu: natural });
      } else if (command.widthEmu !== undefined || command.heightEmu !== undefined) {
        ops.push({
          op: 'resizeDrawing',
          drawingNodeId: resolved.id,
          extentEmu: {
            cx: command.widthEmu ?? image.widthEmu,
            cy: command.heightEmu ?? image.heightEmu,
          },
        });
      }
      if (command.crop !== undefined) {
        ops.push({
          op: 'cropDrawing',
          drawingNodeId: resolved.id,
          crop: cropPermilleFromCropPercent(command.crop),
        });
      }
      const title = command.title ?? command.alt;
      const description = command.description ?? command.alt;
      if (title !== undefined || description !== undefined) {
        ops.push({
          op: 'setDrawingMetadata',
          drawingNodeId: resolved.id,
          title: title ?? image.title,
          description: description ?? image.description,
        });
      }
      if (command.wrap !== undefined) {
        ops.push({ op: 'setDrawingWrap', drawingNodeId: resolved.id, wrap: command.wrap });
      }
      if (propertiesCommandHasPositionFields(command)) {
        const position = positionInputFromPropertiesCommand(command, image);
        ops.push({ op: 'positionDrawing', drawingNodeId: resolved.id, position });
      }
      if (command.hyperlink !== undefined) {
        const result = surface.applyImageProperties({
          drawingNodeId: resolved.id,
          ops,
          hyperlink: command.hyperlink,
        });
        if (!result.ok) {
          return {
            ok: false,
            code: 'invalidArgs',
            reason: result.detail ?? result.reason ?? 'setImageProperties was refused',
          };
        }
        return null;
      }
      if (ops.length === 0) {
        return {
          ok: false,
          code: 'invalidArgs',
          reason: 'setImageProperties requires at least one field',
        };
      }
      return applyDrawingOps(surface, ops);
    }
    default:
      return null;
  }
}

/**
 * Run an insert or replace, re-checking the same gates {@link canExecuteImageCommand} applies.
 *
 * Async because image bytes must be decoded to derive their natural extent before the drawing can
 * be projected — the one editor command that cannot complete synchronously.
 */
export async function executeImageCommand(
  editor: DocxEditorInstance,
  command: Extract<EditorCommand, { type: 'insertImage' | 'replaceImage' }>
): Promise<ExecResult> {
  const surface = editor.surface;
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  const modeGate = asyncImageExecutionGate(surface);
  if (modeGate) return modeGate;
  const gate = gateImageCommand(command, surface);
  if (gate) return gate;
  const pre = captureImageMutationPreconditions(editor);
  if (!pre) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  if (command.type === 'insertImage') {
    const { anchor } = surface.state().selection;
    const expectedRevision = command.expectedPackageRevision ?? pre.packageRevision;
    if (
      command.expectedPackageRevision !== undefined &&
      surface.session.packageRevision() !== command.expectedPackageRevision
    ) {
      return { ok: false, code: 'notFound', reason: 'stale package revision' };
    }
    const result = await surface.insertImage({
      paragraphId: anchor.paragraphId,
      offset: anchor.offset,
      bytes: command.data,
      mime: command.mime,
      widthPoints: command.widthPoints,
      heightPoints: command.heightPoints,
      expectedPackageRevision: expectedRevision,
      commitGuard: () => isStaleImageMutation(editor, pre) === null,
      ...(command.title !== undefined ? { title: command.title } : {}),
      ...(command.description !== undefined ? { description: command.description } : {}),
      ...(command.hyperlink !== undefined ? { hyperlink: command.hyperlink } : {}),
    });
    const stale = isStaleImageMutation(editor, pre);
    if (stale) return stale;
    if (!result.ok) {
      return {
        ok: false,
        code: 'invalidArgs',
        reason:
          result.detail === 'stale-package-epoch'
            ? 'stale package revision'
            : (result.detail ?? result.reason ?? 'insertImage was refused'),
      };
    }
    return { ok: true, changed: result.change !== null };
  }
  const resolved = selectedOrRequestedId(surface, command);
  if ('ok' in resolved) return resolved;
  const expectedRevision = command.expectedPackageRevision ?? pre.packageRevision;
  if (
    command.expectedPackageRevision !== undefined &&
    surface.session.packageRevision() !== command.expectedPackageRevision
  ) {
    return { ok: false, code: 'notFound', reason: 'stale package revision' };
  }
  const mime = (command.mime ?? 'image/png') as SupportedImageMime;
  const result = await surface.replaceImage(resolved.id, command.data, mime, {
    expectedPackageRevision: expectedRevision,
    commitGuard: () =>
      isStaleImageMutation(editor, pre, {
        requireDrawing: true,
        drawingNodeId: resolved.id,
      }) === null,
  });
  const stale = isStaleImageMutation(editor, pre, {
    requireDrawing: true,
    drawingNodeId: resolved.id,
  });
  if (stale) return stale;
  if (!result.ok) {
    return {
      ok: false,
      code: 'invalidArgs',
      reason:
        result.detail === 'stale-package-epoch'
          ? 'stale package revision'
          : (result.detail ?? result.reason ?? 'replaceImage was refused'),
    };
  }
  return { ok: true, changed: result.change !== null };
}

/** Which of the eight resize handles a drag started from, by compass direction. */
export type ImageResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

/** How far one arrow-key press nudges a selected image, in points. */
export const IMAGE_OVERLAY_NUDGE_PT = 1;

/** How far Shift+arrow nudges a selected image, in points. */
export const IMAGE_OVERLAY_NUDGE_SHIFT_PT = 10;

/** EMUs per point. DrawingML stores extents in EMU; layout works in points. */
export const EMU_PER_POINT = 12_700;

/**
 * One in-flight image drag: where it started, and everything needed to decide at commit time
 * whether the document still describes what the gesture was planned against.
 *
 * Both revisions are captured because they move independently — layout can re-flow without the
 * package changing, and vice versa.
 */
export interface ImageInteractionSession {
  readonly drawingNodeId: string;
  readonly startBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly startWidthEmu: number;
  readonly startHeightEmu: number;
  readonly startPosition: DrawingPositionInput | null;
  readonly anchorFrameOrigin: { readonly x: number; readonly y: number } | null;
  readonly transform: DrawingTransform;
  readonly mode: 'move' | 'resize';
  readonly handle: ImageResizeHandle | null;
  readonly preconditions: ImageMutationPreconditions;
  readonly layoutRevision: number;
  readonly packageRevision: number;
  readonly kind: 'inline' | 'anchored';
}

/**
 * How an image drag scrolls the page when it reaches the viewport edge.
 *
 * Returns the delta ACTUALLY applied rather than the one requested, because a drag at the end of
 * the document cannot scroll further and the overlay must not move the image by a distance the
 * page did not travel.
 */
export interface ImageOverlayScrollPort {
  /** Scroll by a preview delta and return the actual applied document-space delta in points. */
  scrollBy(deltaY: number): number;
}

/**
 * The painted geometry of the selected drawing, plus what the overlay is allowed to do to it.
 *
 * Carries BOTH the painted rect (points, for hit-testing and handle placement) and the stored
 * extent (EMU, for writing back), so the overlay never has to convert between the two spaces to
 * decide what it is looking at.
 */
export interface SelectedDrawingOverlayTarget {
  readonly id: string;
  readonly pageIndex: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kind: 'inline' | 'anchored';
  readonly widthEmu: number;
  readonly heightEmu: number;
  readonly position: DrawingPositionInput | null;
  readonly anchorFrameOrigin: { readonly x: number; readonly y: number } | null;
  readonly transform: DrawingTransform;
  readonly canResize: boolean;
  readonly canMove: boolean;
  /** Hard lock from `noChangeAspect` — never overridden by Shift. */
  readonly aspectLocked: boolean;
}

function overlayCapabilityFlags(
  _record: SelectedDrawingRecord,
  projection: DrawingProjection | null
): Pick<SelectedDrawingOverlayTarget, 'canResize' | 'canMove' | 'aspectLocked'> {
  if (!projection || projection.hidden || projection.locks.select) {
    return Object.freeze({ canResize: false, canMove: false, aspectLocked: true });
  }
  const caps = capabilityFlags(projection);
  return Object.freeze({
    canResize: caps.canResize,
    canMove: caps.canMove,
    aspectLocked: projection.locks.changeAspect,
  });
}

/**
 * The painted geometry of the selected drawing, for the resize/move overlay — or null.
 *
 * Stricter than {@link selectedImageStateOf}: it also requires a COLLAPSED selection, because a
 * range that merely contains a drawing is a text selection, and drawing handles over it would
 * claim an object the user did not single out.
 */
export function selectedDrawingOverlayTargetOf(
  surface: PaginatedSurface | null
): SelectedDrawingOverlayTarget | null {
  if (!surface) return null;
  const { anchor, head } = surface.state().selection;
  if (anchor.paragraphId !== head.paragraphId || anchor.offset !== head.offset) return null;
  const record = resolveSelectedDrawingRecord(surface);
  if (!record) return null;
  if (record.accessibility.hidden) return null;
  // `layout()`, not `publishedLayout()`: the caller is about to act on this geometry — place
  // handles, stamp a drag session — so a pass still parked on the scheduler's timer must land
  // first. Nothing pending makes this a plain read.
  const layout = surface.layout();
  const frame = findDrawingOverlayFrameInLayout(layout, record.drawingNodeId);
  if (!frame) return null;
  const projection = projectDrawingForRecord(surface, record);
  if (!projection || projection.locks.select) return null;
  const caps = overlayCapabilityFlags(record, projection);
  // The MODE, on top of the drawing's own OOXML locks. Without it a viewing-mode reader got
  // eight resize handles, a `move` cursor and a live drag preview that auto-scrolled the
  // document — then snapped back when the write was refused. The selection ring stays: the
  // image is still selectable, copyable and describable in a document open for viewing.
  const writable = surface.editingMode() === 'edit' && surface.session.editable;
  const gated = writable ? caps : { ...caps, canResize: false, canMove: false };
  const anchorFrameOrigin =
    record.kind === 'anchoredDrawing'
      ? Object.freeze({
          x: record.horizontalFrameOrigin,
          y: record.verticalFrameOrigin,
        })
      : null;
  return Object.freeze({
    id: record.drawingNodeId,
    pageIndex: frame.pageIndex,
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height,
    kind: record.kind === 'inlineDrawing' ? 'inline' : 'anchored',
    widthEmu: projection.extentEmu.cx,
    heightEmu: projection.extentEmu.cy,
    position: positionInputOf(projection),
    anchorFrameOrigin,
    transform: record.transform,
    ...gated,
  });
}

/** Points to EMU, rounded — EMUs are integral in the file. */
export function pointsToEmu(points: number): number {
  return Math.round(points * EMU_PER_POINT);
}

/** EMU to points. Unrounded, so overlay geometry keeps sub-point precision during a drag. */
export function emuToOverlayPoints(emu: number): number {
  return emu / EMU_PER_POINT;
}

/**
 * The extent a resize drag produces, in EMU.
 *
 * Computed from the drag's START extent rather than the previous frame's, so a drag that reverses
 * direction lands exactly where it began instead of accumulating rounding error.
 *
 * `preserveAspect` behaves the way Word's handles do: a corner handle scales by whichever axis
 * moved further, while an edge handle drives the other axis from the original ratio. Both axes
 * are floored at one point, so a drag past the opposite edge cannot invert the image.
 */
export function computeResizedImageExtentEmu(
  startWidthEmu: number,
  startHeightEmu: number,
  handle: ImageResizeHandle,
  deltaWidthPt: number,
  deltaHeightPt: number,
  preserveAspect: boolean
): { readonly cx: number; readonly cy: number } {
  let widthPt = emuToOverlayPoints(startWidthEmu);
  let heightPt = emuToOverlayPoints(startHeightEmu);
  const aspect = widthPt / heightPt;
  const horizontal = handle.includes('e') ? deltaWidthPt : handle.includes('w') ? -deltaWidthPt : 0;
  const vertical = handle.includes('s') ? deltaHeightPt : handle.includes('n') ? -deltaHeightPt : 0;
  widthPt = Math.max(1, widthPt + horizontal);
  heightPt = Math.max(1, heightPt + vertical);
  if (preserveAspect) {
    const corner = handle.length === 2;
    if (corner) {
      const scale = Math.max(
        widthPt / emuToOverlayPoints(startWidthEmu),
        heightPt / emuToOverlayPoints(startHeightEmu)
      );
      widthPt = Math.max(1, emuToOverlayPoints(startWidthEmu) * scale);
      heightPt = Math.max(1, widthPt / aspect);
    } else if (handle === 'e' || handle === 'w') {
      heightPt = Math.max(1, widthPt / aspect);
    } else {
      widthPt = Math.max(1, heightPt * aspect);
    }
  }
  return Object.freeze({ cx: pointsToEmu(widthPt), cy: pointsToEmu(heightPt) });
}

/**
 * The position a move drag produces, preserving the anchoring the file already used.
 *
 * A `frame`-mode position keeps its `relativeToH`/`relativeToV` bases and only shifts the offsets
 * it actually had — writing an offset the file omitted would re-anchor the drawing to a different
 * reference and move it somewhere the drag never pointed.
 */
export function computeMovedImagePosition(
  start: DrawingPositionInput,
  deltaXPt: number,
  deltaYPt: number
): DrawingPositionInput {
  if (start.mode === 'simple') {
    return Object.freeze({
      mode: 'simple' as const,
      horizontalEmu: (start.horizontalEmu ?? 0) + pointsToEmu(deltaXPt),
      verticalEmu: (start.verticalEmu ?? 0) + pointsToEmu(deltaYPt),
    });
  }
  return Object.freeze({
    mode: 'frame' as const,
    ...(start.horizontalEmu !== undefined
      ? { horizontalEmu: start.horizontalEmu + pointsToEmu(deltaXPt) }
      : {}),
    ...(start.verticalEmu !== undefined
      ? { verticalEmu: start.verticalEmu + pointsToEmu(deltaYPt) }
      : {}),
    ...(start.relativeToH !== undefined ? { relativeToH: start.relativeToH } : {}),
    ...(start.relativeToV !== undefined ? { relativeToV: start.relativeToV } : {}),
  });
}

/**
 * Whether a drag's commit should be refused because the document moved under it — the refusal to
 * return, or null when the commit is still valid.
 *
 * Checks the mount generation and both revisions captured by
 * {@link captureImageMutationPreconditions}. A gesture spans many frames, so this is the one
 * place that decides its coordinates still describe the document they were measured against.
 */
export function isStaleImageInteractionCommit(
  editor: Pick<DocxEditorInstance, 'surface' | 'mountGeneration'>,
  session: ImageInteractionSession
): ExecResult | null {
  const surface = editor.surface;
  if (!surface) return { ok: false, code: 'notFound', reason: 'no document is loaded' };
  if (surface.publishedLayout().revision !== session.layoutRevision) {
    return { ok: false, code: 'notFound', reason: 'stale layout revision' };
  }
  if (surface.session.packageRevision() !== session.packageRevision) {
    return { ok: false, code: 'notFound', reason: 'stale package revision' };
  }
  return isStaleImageMutation(editor, session.preconditions, {
    requireDrawing: true,
    drawingNodeId: session.drawingNodeId,
  });
}
