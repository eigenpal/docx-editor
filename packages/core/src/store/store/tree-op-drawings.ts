// Canonical drawing mutations over the OOXML tree (typed-drawings-and-images task 11).
//
// Pure tree edits only — package media/relationship lifecycle stays in task 12. Each op
// copy-modifies only the ancestor path, preserves unclaimed siblings/attributes/extensions,
// validates before mutation, and publishes a typed rejection on failure.

import {
  createNodeIdAllocator,
  findNode,
  removeNode,
  replaceNode,
  type EditOptions,
} from '../package/ooxml-edit.ts';
import {
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  IMAGE_WRAP_TARGETS,
  projectDrawing,
  type DrawingHorizontalReferenceFrame,
  type DrawingLocks,
  type DrawingLocksInput,
  type DrawingPositionInput,
  type DrawingProjection,
  type ImageWrapTarget,
  type SourceCrop,
} from '../package/drawing-projection.ts';
import { validateDrawingPositionInput } from '../package/drawing-position-input.ts';
import { ST_POSITIVE_COORDINATE_MAX } from '../package/ooxml-drawing-rules.ts';
import { sanitizeHref } from '../package/sinks.ts';
import {
  DRAWINGML_MAIN_NAMESPACE_URI,
  PIC_NAMESPACE_URI,
  RELATIONSHIPS_NAMESPACE_URI,
  WP_NAMESPACE_URI,
  type OoxmlAttribute,
  type OoxmlDrawingNode,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import { cloneWithNewIds, fromEdit, parentOf, TEXT_DEPS } from './tree-op-nodes.ts';
import { applyInsertTrackedRun, build as buildTrackedNode } from './tree-op-tracked.ts';
import { invalidRevisionAttribution } from './tree-op-types.ts';
import { insertRunPayloadAtOffset, offsetInsideAtomicSegment } from './tree-op-insert-offset.ts';
import { isTableNested } from './tree-op-section-address.ts';
import { isParagraph, paragraphLength, segmentsOf, splitsSurrogate } from './tree-op-segments.ts';
import type {
  DrawingTreeDocOp,
  ImpactClass,
  TreeDocOp,
  TreeOpEffect,
  TreeOpRejection,
  TreeOpResult,
} from './tree-op-types.ts';

const MAX_CROP_PERMILLE = 100_000;

function parseOoxmlBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return undefined;
}

function ooxmlBooleanString(value: boolean): string {
  return value ? '1' : '0';
}

function paragraphContainingNode(part: OoxmlPart, nodeId: string): OoxmlParagraphNode | null {
  let current: OoxmlNode | null = findNode(part, nodeId);
  while (current) {
    if (current.kind === 'paragraph') return current as OoxmlParagraphNode;
    const parent = parentOf(part, current.id);
    current = parent;
  }
  return null;
}

function isPositionOrWrapChild(child: OoxmlElement): boolean {
  if (
    child.kind === 'drawingSimplePos' ||
    child.kind === 'drawingPositionH' ||
    child.kind === 'drawingPositionV' ||
    child.kind === 'drawingWrapNone' ||
    child.kind === 'drawingWrapSquare' ||
    child.kind === 'drawingWrapTight' ||
    child.kind === 'drawingWrapThrough' ||
    child.kind === 'drawingWrapTopBottom'
  ) {
    return true;
  }
  if (child.namespaceUri !== WP_NAMESPACE_URI) return false;
  return (
    child.localName === 'simplePos' ||
    child.localName === 'positionH' ||
    child.localName === 'positionV' ||
    child.localName.startsWith('wrap')
  );
}

function readExtentEmu(anchor: OoxmlElement): { cx: number; cy: number } {
  const extent =
    findDirectChild(anchor.children, { kind: 'drawingExtent' }) ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'extent' });
  const cx = Number(schemaAttributeValue(extent?.attributes ?? [], 'cx') ?? '914400');
  const cy = Number(schemaAttributeValue(extent?.attributes ?? [], 'cy') ?? '914400');
  return { cx, cy };
}

function rectangularWrapPolygon(cx: number, cy: number, nextId: () => string): OoxmlElement {
  const point = (
    kind: 'drawingWrapPolygonStart' | 'drawingWrapPolygonLineTo',
    localName: 'start' | 'lineTo',
    x: number,
    y: number
  ): OoxmlElement =>
    ({
      id: nextId(),
      kind,
      namespaceUri: WP_NAMESPACE_URI,
      localName,
      prefix: 'wp',
      namespaceBindings: [],
      attributes: [attr('x', String(Math.round(x))), attr('y', String(Math.round(y)))],
      children: [],
    }) as OoxmlElement;

  return {
    id: nextId(),
    kind: 'drawingWrapPolygon',
    namespaceUri: WP_NAMESPACE_URI,
    localName: 'wrapPolygon',
    prefix: 'wp',
    namespaceBindings: [],
    attributes: [attr('edited', '0')],
    children: [
      point('drawingWrapPolygonStart', 'start', 0, 0),
      point('drawingWrapPolygonLineTo', 'lineTo', cx, 0),
      point('drawingWrapPolygonLineTo', 'lineTo', cx, cy),
      point('drawingWrapPolygonLineTo', 'lineTo', 0, cy),
      point('drawingWrapPolygonLineTo', 'lineTo', 0, 0),
    ],
  } as OoxmlElement;
}

function replaceDrawingChild(
  drawing: OoxmlDrawingNode,
  anchorId: string,
  nextAnchor: OoxmlElement
): OoxmlDrawingNode {
  return replaceNodeShallow(drawing, {
    children: drawing.children.map((child) =>
      child.id === anchorId ? nextAnchor : child
    ) as OoxmlDrawingNode['children'],
  });
}

function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

function schemaAttributeValue(
  attributes: readonly OoxmlAttribute[],
  localName: string
): string | undefined {
  for (const attribute of attributes) {
    if (attribute.localName === localName && attribute.namespaceUri === '') return attribute.value;
  }
  return undefined;
}

function attr(localName: string, value: string): OoxmlAttribute {
  return { kind: 'genericExtension', namespaceUri: '', localName, value };
}

function setSchemaAttribute(
  attributes: readonly OoxmlAttribute[],
  localName: string,
  value: string | undefined
): OoxmlAttribute[] {
  const next = attributes.filter(
    (attribute) => !(attribute.localName === localName && attribute.namespaceUri === '')
  );
  if (value !== undefined) next.push(attr(localName, value));
  return next;
}

function replaceNodeShallow<T extends OoxmlElement>(
  node: T,
  patch: Partial<T> & { readonly children?: readonly OoxmlNode[] }
): T {
  return { ...node, ...patch } as T;
}

function findDirectChild(
  children: readonly OoxmlNode[],
  match: { readonly kind?: string; readonly localName?: string; readonly namespaceUri?: string }
): OoxmlElement | null {
  for (const child of children) {
    if (!isElement(child)) continue;
    if (match.kind !== undefined && child.kind !== match.kind) continue;
    if (match.localName !== undefined && child.localName !== match.localName) continue;
    if (match.namespaceUri !== undefined && child.namespaceUri !== match.namespaceUri) continue;
    return child;
  }
  return null;
}

function anchorRootOf(drawing: OoxmlDrawingNode): OoxmlElement | null {
  return (
    findDirectChild(drawing.children, { kind: 'inlineDrawing' }) ??
    findDirectChild(drawing.children, { kind: 'anchoredDrawing' }) ??
    findDirectChild(drawing.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'inline' }) ??
    findDirectChild(drawing.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'anchor' })
  );
}

function isTopLevelDrawing(part: OoxmlPart, nodeId: string): nodeId is string {
  const node = findNode(part, nodeId);
  return node !== null && node.kind === 'drawing';
}

function projectionOf(part: OoxmlPart, drawing: OoxmlDrawingNode): DrawingProjection | null {
  return projectDrawing(drawing, {
    ownerPartName: part.name,
    supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
  });
}

function isPictureProjection(
  projection: DrawingProjection | null
): projection is DrawingProjection {
  return projection !== null && projection.picture !== null;
}

function validateFinitePositiveEmu(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= ST_POSITIVE_COORDINATE_MAX;
}

function validateCrop(crop: SourceCrop): boolean {
  const edges = [crop.left, crop.top, crop.right, crop.bottom];
  if (edges.some((edge) => !Number.isFinite(edge) || edge < 0 || edge > MAX_CROP_PERMILLE)) {
    return false;
  }
  return crop.left + crop.right < MAX_CROP_PERMILLE && crop.top + crop.bottom < MAX_CROP_PERMILLE;
}

function cropPermille(value: number): string {
  return String(Math.round(value));
}

function readFrameLocksFromTree(anchor: OoxmlElement): DrawingLocksInput {
  const framePr =
    findDirectChild(anchor.children, { kind: 'drawingGraphicFramePr' }) ??
    findDirectChild(anchor.children, {
      namespaceUri: WP_NAMESPACE_URI,
      localName: 'cNvGraphicFramePr',
    });
  if (!framePr) return {};
  const frameLocks = framePr.children.find(
    (child) =>
      isElement(child) &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      child.localName === 'graphicFrameLocks'
  );
  if (!frameLocks || !isElement(frameLocks)) return {};
  const locked = (name: string): boolean | undefined => {
    const value = schemaAttributeValue(frameLocks.attributes, name);
    return parseOoxmlBoolean(value);
  };
  return {
    select: locked('noSelect'),
    move: locked('noMove'),
    resize: locked('noResize'),
    changeAspect: locked('noChangeAspect'),
  };
}

function effectiveLocks(anchor: OoxmlElement): DrawingLocks {
  const anchorLocked =
    parseOoxmlBoolean(schemaAttributeValue(anchor.attributes, 'locked')) === true;
  if (anchorLocked) {
    return Object.freeze({ select: true, move: true, resize: true, changeAspect: true });
  }
  const frame = readFrameLocksFromTree(anchor);
  return Object.freeze({
    select: frame.select ?? false,
    move: frame.move ?? false,
    resize: frame.resize ?? false,
    changeAspect: frame.changeAspect ?? false,
  });
}

function lockBlocks(anchor: OoxmlElement, op: DrawingTreeDocOp['op']): TreeOpRejection | null {
  const locks = effectiveLocks(anchor);
  if (op === 'deleteDrawing' && locks.select) return 'drawing-locked';
  if (op === 'resizeDrawing' && locks.resize) return 'drawing-locked';
  if (op === 'cropDrawing' && (locks.resize || locks.changeAspect)) return 'drawing-locked';
  if (op === 'positionDrawing' && locks.move) return 'drawing-locked';
  if (op === 'setDrawingWrap' && locks.move) return 'drawing-locked';
  if (op === 'transformDrawing' && (locks.resize || locks.changeAspect)) return 'drawing-locked';
  if (op === 'setDrawingLocks') return null;
  if (op === 'setDrawingMetadata') return null;
  if (op === 'replaceDrawingResource' && locks.resize) return 'drawing-locked';
  return null;
}

function drawingContext(
  part: OoxmlPart,
  drawingNodeId: string
):
  | { drawing: OoxmlDrawingNode; anchor: OoxmlElement; projection: DrawingProjection }
  | TreeOpRejection {
  if (!isTopLevelDrawing(part, drawingNodeId)) {
    const node = findNode(part, drawingNodeId);
    if (!node) return 'unknown-drawing';
    return 'not-a-drawing';
  }
  const drawing = findNode(part, drawingNodeId) as OoxmlDrawingNode;
  const anchor = anchorRootOf(drawing);
  if (!anchor) return 'not-a-drawing';
  const projection = projectionOf(part, drawing);
  if (!projection) return 'not-a-picture-drawing';
  if (!isPictureProjection(projection)) return 'not-a-picture-drawing';
  return { drawing, anchor, projection };
}

function validateRelationshipId(value: string): boolean {
  return value.length > 0 && value.length <= 512 && /^[A-Za-z0-9._-]+$/.test(value);
}

/** Impact class for a drawing op — metadata/locks are text-local; geometry/wrap are flow-structural. */
export function drawingOpImpact(op: DrawingTreeDocOp): ImpactClass {
  switch (op.op) {
    case 'setDrawingMetadata':
    case 'setDrawingLocks':
    case 'replaceDrawingResource':
      return 'text-local';
    case 'insertDrawing':
    case 'deleteDrawing':
    case 'resizeDrawing':
    case 'cropDrawing':
    case 'positionDrawing':
    case 'setDrawingWrap':
    case 'transformDrawing':
      return 'flow-structural';
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return 'flow-structural';
    }
  }
}

/** Validate a drawing op's extents, crops and positions before it reaches the store. */
export function validateDrawingOp(part: OoxmlPart, op: DrawingTreeDocOp): TreeOpRejection | null {
  switch (op.op) {
    case 'insertDrawing': {
      const paragraph = findNode(part, op.paragraphId);
      if (!paragraph) return 'unknown-paragraph';
      if (!isParagraph(paragraph)) return 'not-a-paragraph';
      const len = paragraphLength(paragraph);
      if (!Number.isInteger(op.offset) || op.offset < 0 || op.offset > len)
        return 'offset-out-of-range';
      if (splitsSurrogate(paragraph, op.offset)) return 'splits-surrogate-pair';
      if (offsetInsideAtomicSegment(paragraph, op.offset)) return 'invalid-range';
      const boundary = segmentsOf(paragraph).find((segment) => segment.start === op.offset);
      if (
        boundary?.removeNodeIds &&
        boundary.removeNodeIds.length > 0 &&
        boundary.node.kind !== 'textValue' &&
        boundary.node.kind !== 'tab' &&
        boundary.node.kind !== 'hardBreak'
      ) {
        return 'invalid-range';
      }
      if (op.drawing.kind !== 'drawing') return 'not-a-drawing';
      const anchor = anchorRootOf(op.drawing);
      if (!anchor) return 'not-a-drawing';
      const projection = projectionOf(part, op.drawing);
      if (!isPictureProjection(projection)) return 'not-a-picture-drawing';
      // `CT_TrackChange` makes `@w:author` required, so a tracked variant with an empty one
      // would serialize a proposal no reader can attribute or resolve.
      if (op.revision !== undefined && invalidRevisionAttribution(op.revision)) {
        return 'invalid-property-value';
      }
      if (isTableNested(part, op.paragraphId) && op.offset !== len && op.offset !== 0) {
        const boundary = segmentsOf(paragraph).find((segment) => segment.start === op.offset);
        if (!boundary) return 'cross-cell-drawing';
      }
      return null;
    }
    case 'deleteDrawing': {
      if (op.revision) return 'trackedDrawingDeletionUnsupported';
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      return lockBlocks(ctx.anchor, op.op);
    }
    case 'replaceDrawingResource': {
      if (!validateRelationshipId(op.relationshipId)) return 'invalid-drawing-value';
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      return lockBlocks(ctx.anchor, op.op);
    }
    case 'resizeDrawing': {
      if (
        !validateFinitePositiveEmu(op.extentEmu.cx) ||
        !validateFinitePositiveEmu(op.extentEmu.cy)
      ) {
        return 'invalid-drawing-value';
      }
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      return lockBlocks(ctx.anchor, op.op);
    }
    case 'cropDrawing': {
      if (!validateCrop(op.crop)) return 'invalid-drawing-value';
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      return lockBlocks(ctx.anchor, op.op);
    }
    case 'positionDrawing': {
      if (!validateDrawingPositionInput(op.position)) return 'invalid-drawing-value';
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      if (ctx.projection.kind !== 'anchored') return 'invalid-drawing-value';
      return lockBlocks(ctx.anchor, op.op);
    }
    case 'setDrawingWrap': {
      if (!IMAGE_WRAP_TARGETS.includes(op.wrap)) return 'invalid-drawing-value';
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      return lockBlocks(ctx.anchor, op.op);
    }
    case 'setDrawingMetadata': {
      if (!isValidXmlMetadata(op.title) || !isValidXmlMetadata(op.description)) {
        return 'invalid-drawing-value';
      }
      if (op.hyperlink !== undefined && op.hyperlink !== null && !sanitizeHref(op.hyperlink).ok) {
        return 'invalid-drawing-value';
      }
      if (op.hyperlink !== undefined && op.hyperlink !== null) {
        return 'packageTransactionRequired';
      }
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      return null;
    }
    case 'setDrawingLocks': {
      for (const value of [
        op.locks.select,
        op.locks.move,
        op.locks.resize,
        op.locks.changeAspect,
      ]) {
        if (value !== undefined && typeof value !== 'boolean') return 'invalid-drawing-value';
      }
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      return null;
    }
    case 'transformDrawing': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return ctx;
      if (!ctx.projection.picture) return 'not-a-drawing';
      return lockBlocks(ctx.anchor, op.op);
    }
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return 'unknown-op';
    }
  }
}

function isValidXmlMetadata(value: string): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0 ||
      (code >= 0x1 && code <= 0x8) ||
      code === 0xb ||
      code === 0xc ||
      (code >= 0xe && code <= 0x1f)
    ) {
      return false;
    }
  }
  return true;
}

function drawingEffect(part: OoxmlPart, drawingId: string, op: DrawingTreeDocOp): TreeOpEffect {
  const paragraph = paragraphContainingNode(part, drawingId);
  const dirty = paragraph ? [paragraph.id, drawingId] : [drawingId];
  return {
    dirty,
    created: [],
    deleted: [],
    dependencyKeys: TEXT_DEPS,
    impact: drawingOpImpact(op),
  };
}

function updateExtent(anchor: OoxmlElement, cx: number, cy: number): OoxmlElement {
  const extent =
    findDirectChild(anchor.children, { kind: 'drawingExtent' }) ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'extent' });
  if (!extent) return anchor;
  const updated = replaceNodeShallow(extent, {
    attributes: setSchemaAttribute(
      setSchemaAttribute(extent.attributes, 'cx', String(Math.round(cx))),
      'cy',
      String(Math.round(cy))
    ),
  });
  return replaceNodeShallow(anchor, {
    children: anchor.children.map((child) => (child.id === extent.id ? updated : child)),
  });
}

function findPictureNode(anchor: OoxmlElement): OoxmlElement | null {
  const graphic = findDirectChild(anchor.children, { kind: 'drawingGraphic' });
  if (!graphic) return null;
  const data = findDirectChild(graphic.children, { kind: 'drawingGraphicData' });
  if (!data) return null;
  return findDirectChild(data.children, { kind: 'picture' });
}

function findBlipNode(picture: OoxmlElement): OoxmlElement | null {
  const blipFill =
    findDirectChild(picture.children, { kind: 'pictureBlipFill' }) ??
    findDirectChild(picture.children, { namespaceUri: PIC_NAMESPACE_URI, localName: 'blipFill' });
  if (!blipFill) return null;
  return (
    findDirectChild(blipFill.children, { kind: 'pictureBlip' }) ??
    findDirectChild(blipFill.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'blip',
    })
  );
}

function relAttr(localName: 'embed' | 'link' | 'id', value: string): OoxmlAttribute {
  return {
    kind: 'genericExtension',
    namespaceUri: RELATIONSHIPS_NAMESPACE_URI,
    localName,
    prefix: 'r',
    value,
  };
}

function setRelationshipAttribute(
  attributes: readonly OoxmlAttribute[],
  localName: 'embed' | 'link' | 'id',
  value: string | undefined
): OoxmlAttribute[] {
  const filtered = attributes.filter(
    (attribute) =>
      !(attribute.localName === localName && attribute.namespaceUri === RELATIONSHIPS_NAMESPACE_URI)
  );
  if (value !== undefined) filtered.push(relAttr(localName, value));
  return filtered;
}

function updateBlipRelationship(anchor: OoxmlElement, relationshipId: string): OoxmlElement {
  const picture = findPictureNode(anchor);
  if (!picture) return anchor;
  const blipFill = picture.children.find(
    (child) =>
      isElement(child) && (child.kind === 'pictureBlipFill' || child.localName === 'blipFill')
  ) as OoxmlElement | undefined;
  if (!blipFill) return anchor;
  const blip = findBlipNode(picture);
  if (!blip) return anchor;
  const updatedBlip = replaceNodeShallow(blip, {
    attributes: setRelationshipAttribute(
      setRelationshipAttribute(blip.attributes, 'link', undefined),
      'embed',
      relationshipId
    ),
  });
  const updatedFill = replaceNodeShallow(blipFill, {
    children: blipFill.children.map((child) => (child.id === blip.id ? updatedBlip : child)),
  });
  const updatedPicture = replaceNodeShallow(picture, {
    children: picture.children.map((child) => (child.id === blipFill.id ? updatedFill : child)),
  });
  const graphic = findDirectChild(anchor.children, { kind: 'drawingGraphic' })!;
  const data = findDirectChild(graphic.children, { kind: 'drawingGraphicData' })!;
  const updatedData = replaceNodeShallow(data, {
    children: data.children.map((child) => (child.id === picture.id ? updatedPicture : child)),
  });
  const updatedGraphic = replaceNodeShallow(graphic, {
    children: graphic.children.map((child) => (child.id === data.id ? updatedData : child)),
  });
  return replaceNodeShallow(anchor, {
    children: anchor.children.map((child) => (child.id === graphic.id ? updatedGraphic : child)),
  });
}

function updateCrop(anchor: OoxmlElement, crop: SourceCrop, nextId: () => string): OoxmlElement {
  const picture = findPictureNode(anchor);
  if (!picture) return anchor;
  const blipFill = picture.children.find(
    (child) =>
      isElement(child) && (child.kind === 'pictureBlipFill' || child.localName === 'blipFill')
  ) as OoxmlElement | undefined;
  if (!blipFill) return anchor;
  let srcRect =
    findDirectChild(blipFill.children, { kind: 'pictureSrcRect' }) ??
    findDirectChild(blipFill.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'srcRect',
    });
  const attrs = setSchemaAttribute(
    setSchemaAttribute(
      setSchemaAttribute(
        setSchemaAttribute(srcRect?.attributes ?? [], 'l', cropPermille(crop.left)),
        't',
        cropPermille(crop.top)
      ),
      'r',
      cropPermille(crop.right)
    ),
    'b',
    cropPermille(crop.bottom)
  );
  if (!srcRect) {
    srcRect = {
      id: nextId(),
      kind: 'pictureSrcRect',
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'srcRect',
      prefix: 'a',
      namespaceBindings: [],
      attributes: attrs,
      children: [],
    } as OoxmlElement;
    const blipIndex = blipFill.children.findIndex(
      (child) => isElement(child) && (child.kind === 'pictureBlip' || child.localName === 'blip')
    );
    const insertAt = blipIndex >= 0 ? blipIndex + 1 : 0;
    const nextChildren = [...blipFill.children];
    nextChildren.splice(insertAt, 0, srcRect);
    const updatedFill = replaceNodeShallow(blipFill, { children: nextChildren });
    const updatedPicture = replaceNodeShallow(picture, {
      children: picture.children.map((child) => (child.id === blipFill.id ? updatedFill : child)),
    });
    return updatePictureInAnchor(anchor, updatedPicture);
  }
  const updatedSrcRect = replaceNodeShallow(srcRect, { attributes: attrs });
  const updatedFill = replaceNodeShallow(blipFill, {
    children: blipFill.children.map((child) => (child.id === srcRect!.id ? updatedSrcRect : child)),
  });
  const updatedPicture = replaceNodeShallow(picture, {
    children: picture.children.map((child) => (child.id === blipFill.id ? updatedFill : child)),
  });
  return updatePictureInAnchor(anchor, updatedPicture);
}

function updatePictureInAnchor(anchor: OoxmlElement, picture: OoxmlElement): OoxmlElement {
  const graphic = findDirectChild(anchor.children, { kind: 'drawingGraphic' })!;
  const data = findDirectChild(graphic.children, { kind: 'drawingGraphicData' })!;
  const updatedData = replaceNodeShallow(data, {
    children: data.children.map((child) => (child.id === picture.id ? picture : child)),
  });
  const updatedGraphic = replaceNodeShallow(graphic, {
    children: graphic.children.map((child) => (child.id === data.id ? updatedData : child)),
  });
  return replaceNodeShallow(anchor, {
    children: anchor.children.map((child) => (child.id === graphic.id ? updatedGraphic : child)),
  });
}

function findShapeProperties(picture: OoxmlElement): OoxmlElement | null {
  return (
    findDirectChild(picture.children, { kind: 'pictureShapeProperties' }) ??
    findDirectChild(picture.children, { namespaceUri: PIC_NAMESPACE_URI, localName: 'spPr' })
  );
}

function updateTransform(
  anchor: OoxmlElement,
  projection: DrawingProjection,
  action: 'rotateCW' | 'rotateCCW' | 'flipH' | 'flipV'
): OoxmlElement {
  const picture = findPictureNode(anchor);
  if (!picture || !projection.picture) return anchor;
  const spPr = findShapeProperties(picture);
  if (!spPr) return anchor;
  const xfrm =
    findDirectChild(spPr.children, { kind: 'drawingTransform' }) ??
    findDirectChild(spPr.children, {
      namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
      localName: 'xfrm',
    });
  let rotationDegrees = projection.picture.transform.rotationDegrees;
  let flipHorizontal = projection.picture.transform.flipHorizontal;
  let flipVertical = projection.picture.transform.flipVertical;
  switch (action) {
    case 'rotateCW':
      rotationDegrees = (rotationDegrees + 90) % 360;
      break;
    case 'rotateCCW':
      rotationDegrees = (rotationDegrees + 270) % 360;
      break;
    case 'flipH':
      flipHorizontal = !flipHorizontal;
      break;
    case 'flipV':
      flipVertical = !flipVertical;
      break;
  }
  const attrs = [...(xfrm?.attributes ?? [])];
  const rotAttr = Math.round(rotationDegrees * 60_000);
  const nextAttrs = setSchemaAttribute(
    setSchemaAttribute(
      setSchemaAttribute(attrs, 'rot', rotAttr === 0 ? undefined : String(rotAttr)),
      'flipH',
      flipHorizontal ? '1' : undefined
    ),
    'flipV',
    flipVertical ? '1' : undefined
  );
  if (!xfrm) return anchor;
  const updatedXfrm = replaceNodeShallow(xfrm, { attributes: nextAttrs });
  const updatedSpPr = replaceNodeShallow(spPr, {
    children: spPr.children.map((child) => (child.id === xfrm.id ? updatedXfrm : child)),
  });
  const updatedPicture = replaceNodeShallow(picture, {
    children: picture.children.map((child) => (child.id === spPr.id ? updatedSpPr : child)),
  });
  return updatePictureInAnchor(anchor, updatedPicture);
}

function updateDocPrMetadata(
  anchor: OoxmlElement,
  title: string,
  description: string,
  hyperlink: string | null | undefined
): OoxmlElement {
  const docPr =
    findDirectChild(anchor.children, { kind: 'drawingDocPr' }) ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'docPr' });
  if (!docPr) return anchor;
  const attrs = setSchemaAttribute(
    setSchemaAttribute(docPr.attributes, 'title', title.length > 0 ? title : undefined),
    'descr',
    description.length > 0 ? description : undefined
  );
  let children = [...docPr.children];
  if (hyperlink === null) {
    children = children.filter(
      (child) =>
        !(
          isElement(child) &&
          child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
          child.localName === 'hlinkClick'
        )
    );
  }
  const updatedDocPr = replaceNodeShallow(docPr, { attributes: attrs, children });
  return replaceNodeShallow(anchor, {
    children: anchor.children.map((child) => (child.id === docPr.id ? updatedDocPr : child)),
  });
}

/** Read the current `a:hlinkClick/@r:id` on a drawing anchor, if any. */
export function docPrHyperlinkRelationshipId(anchor: OoxmlElement): string | null {
  const docPr =
    findDirectChild(anchor.children, { kind: 'drawingDocPr' }) ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'docPr' });
  if (!docPr) return null;
  const hlinkClick = docPr.children.find(
    (child) =>
      isElement(child) &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      child.localName === 'hlinkClick'
  );
  if (!hlinkClick || !isElement(hlinkClick)) return null;
  for (const attribute of hlinkClick.attributes) {
    if (attribute.localName !== 'id') continue;
    if (attribute.namespaceUri !== RELATIONSHIPS_NAMESPACE_URI) continue;
    return attribute.value;
  }
  return null;
}

/** Package-transaction helper: set or clear `a:hlinkClick/@r:id` on `wp:docPr`. */
export function setDocPrHyperlinkRelationship(
  anchor: OoxmlElement,
  relationshipId: string | null
): OoxmlElement {
  const docPr =
    findDirectChild(anchor.children, { kind: 'drawingDocPr' }) ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName: 'docPr' });
  if (!docPr) return anchor;
  let children = [...docPr.children];
  if (relationshipId === null) {
    children = children.filter(
      (child) =>
        !(
          isElement(child) &&
          child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
          child.localName === 'hlinkClick'
        )
    );
  } else {
    const existing = children.find(
      (child) =>
        isElement(child) &&
        child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
        child.localName === 'hlinkClick'
    ) as OoxmlElement | undefined;
    if (existing) {
      const updated = replaceNodeShallow(existing, {
        attributes: setRelationshipAttribute(existing.attributes, 'id', relationshipId),
      });
      children = children.map((child) => (child.id === existing.id ? updated : child));
    } else {
      children.push({
        id: `${docPr.id}#hlink`,
        kind: 'generic',
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'hlinkClick',
        prefix: 'a',
        namespaceBindings: [],
        attributes: [relAttr('id', relationshipId)],
        children: [],
      } as OoxmlElement);
    }
  }
  const updatedDocPr = replaceNodeShallow(docPr, { children });
  return replaceNodeShallow(anchor, {
    children: anchor.children.map((child) => (child.id === docPr.id ? updatedDocPr : child)),
  });
}

function mergeLocksInput(current: DrawingLocks, input: DrawingLocksInput): DrawingLocks {
  return Object.freeze({
    select: input.select ?? current.select,
    move: input.move ?? current.move,
    resize: input.resize ?? current.resize,
    changeAspect: input.changeAspect ?? current.changeAspect,
  });
}

const MANAGED_GRAPHIC_FRAME_LOCKS = new Set(['noSelect', 'noMove', 'noResize', 'noChangeAspect']);

const MANAGED_LOCK_FIELDS = [
  ['select', 'noSelect'],
  ['move', 'noMove'],
  ['resize', 'noResize'],
  ['changeAspect', 'noChangeAspect'],
] as const satisfies ReadonlyArray<readonly [keyof DrawingLocks, string]>;

function inputTouchesLock(locks: DrawingLocksInput): boolean {
  return (
    locks.select !== undefined ||
    locks.move !== undefined ||
    locks.resize !== undefined ||
    locks.changeAspect !== undefined
  );
}

function anchorAggregateLocked(anchor: OoxmlElement): boolean {
  return parseOoxmlBoolean(schemaAttributeValue(anchor.attributes, 'locked')) === true;
}

function lockAttrKey(attribute: OoxmlAttribute): string {
  return attribute.namespaceUri === ''
    ? attribute.localName
    : `${attribute.namespaceUri}:${attribute.localName}`;
}

function findGraphicFramePr(anchor: OoxmlElement): OoxmlElement | null {
  return (
    findDirectChild(anchor.children, { kind: 'drawingGraphicFramePr' }) ??
    findDirectChild(anchor.children, {
      namespaceUri: WP_NAMESPACE_URI,
      localName: 'cNvGraphicFramePr',
    })
  );
}

function findGraphicFrameLocks(framePr: OoxmlElement): OoxmlElement | undefined {
  return framePr.children.find(
    (child) =>
      isElement(child) &&
      child.namespaceUri === DRAWINGML_MAIN_NAMESPACE_URI &&
      child.localName === 'graphicFrameLocks'
  ) as OoxmlElement | undefined;
}

function insertGraphicFramePr(anchor: OoxmlElement, framePr: OoxmlElement): OoxmlElement {
  const children = [...anchor.children];
  const graphicIndex = children.findIndex(
    (child) =>
      isElement(child) && (child.kind === 'drawingGraphic' || child.localName === 'graphic')
  );
  children.splice(graphicIndex >= 0 ? graphicIndex : children.length, 0, framePr);
  return replaceNodeShallow(anchor, { children });
}

function replaceGraphicFramePr(
  anchor: OoxmlElement,
  framePrId: string,
  framePr: OoxmlElement
): OoxmlElement {
  return replaceNodeShallow(anchor, {
    children: anchor.children.map((child) => (child.id === framePrId ? framePr : child)),
  });
}

function updateLocks(
  anchor: OoxmlElement,
  _projection: DrawingProjection,
  locks: DrawingLocksInput,
  nextId: () => string
): OoxmlElement {
  const currentEffective = effectiveLocks(anchor);
  const merged = mergeLocksInput(currentEffective, locks);
  const materializeManagedLocks = anchorAggregateLocked(anchor) && inputTouchesLock(locks);
  const anchorLocked = merged.select && merged.move && merged.resize && merged.changeAspect;
  let updated = replaceNodeShallow(anchor, {
    attributes: setSchemaAttribute(anchor.attributes, 'locked', anchorLocked ? '1' : '0'),
  });

  let framePr = findGraphicFramePr(updated);
  if (!framePr) {
    framePr = {
      id: nextId(),
      kind: 'drawingGraphicFramePr',
      namespaceUri: WP_NAMESPACE_URI,
      localName: 'cNvGraphicFramePr',
      prefix: 'wp',
      namespaceBindings: [],
      attributes: [],
      children: [],
    } as OoxmlElement;
    updated = insertGraphicFramePr(updated, framePr);
  }

  const existingLocks = findGraphicFrameLocks(framePr);
  const nextLockAttrs = new Map<string, OoxmlAttribute>();
  for (const attribute of existingLocks?.attributes ?? []) {
    nextLockAttrs.set(lockAttrKey(attribute), attribute);
  }

  const applyManagedLock = (localName: string, value: boolean | undefined): void => {
    if (value === undefined) return;
    const key = localName;
    if (value) {
      const existing = nextLockAttrs.get(key);
      if (existing && parseOoxmlBoolean(existing.value) === true) {
        nextLockAttrs.set(key, existing);
      } else {
        nextLockAttrs.set(key, attr(localName, ooxmlBooleanString(true)));
      }
    } else {
      nextLockAttrs.delete(key);
    }
  };

  for (const [field, attrName] of MANAGED_LOCK_FIELDS) {
    if (materializeManagedLocks) {
      applyManagedLock(attrName, merged[field]);
    } else if (locks[field] !== undefined) {
      applyManagedLock(attrName, locks[field]);
    }
  }

  const hasManagedTrue = ['noSelect', 'noMove', 'noResize', 'noChangeAspect'].some((name) => {
    const value = nextLockAttrs.get(name)?.value;
    return parseOoxmlBoolean(value) === true;
  });
  const hasUnknownLockAttrs = [...nextLockAttrs.values()].some(
    (attribute) =>
      attribute.namespaceUri !== '' || !MANAGED_GRAPHIC_FRAME_LOCKS.has(attribute.localName)
  );

  let frameChildren = framePr.children.filter(
    (child) => !(isElement(child) && child.localName === 'graphicFrameLocks')
  );
  if (hasManagedTrue || hasUnknownLockAttrs) {
    const frameLocks: OoxmlElement = existingLocks
      ? replaceNodeShallow(existingLocks, { attributes: [...nextLockAttrs.values()] })
      : ({
          id: nextId(),
          kind: 'generic',
          namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
          localName: 'graphicFrameLocks',
          prefix: 'a',
          namespaceBindings: [],
          attributes: [...nextLockAttrs.values()],
          children: [],
        } as OoxmlElement);
    frameChildren = [...frameChildren, frameLocks];
  }

  const updatedFrame = {
    ...framePr,
    kind: 'drawingGraphicFramePr',
    children: frameChildren,
  } as OoxmlElement;
  return replaceGraphicFramePr(updated, framePr.id, updatedFrame);
}

/** Map the nine wrap targets to anchor wrap element + behindDoc. */
export function wrapTargetToAnchorSpec(target: ImageWrapTarget): {
  readonly behindDocument: boolean;
  readonly wrapLocalName:
    | 'wrapNone'
    | 'wrapSquare'
    | 'wrapTight'
    | 'wrapThrough'
    | 'wrapTopAndBottom';
  readonly wrapText?: 'bothSides' | 'left' | 'right' | 'largest';
} {
  switch (target) {
    case 'inline':
      return { behindDocument: false, wrapLocalName: 'wrapNone' };
    case 'behind':
      return { behindDocument: true, wrapLocalName: 'wrapNone' };
    case 'inFront':
      return { behindDocument: false, wrapLocalName: 'wrapNone' };
    case 'square':
      return { behindDocument: false, wrapLocalName: 'wrapSquare', wrapText: 'bothSides' };
    case 'squareLeft':
      return { behindDocument: false, wrapLocalName: 'wrapSquare', wrapText: 'left' };
    case 'squareRight':
      return { behindDocument: false, wrapLocalName: 'wrapSquare', wrapText: 'right' };
    case 'tight':
      return { behindDocument: false, wrapLocalName: 'wrapTight', wrapText: 'bothSides' };
    case 'through':
      return { behindDocument: false, wrapLocalName: 'wrapThrough', wrapText: 'bothSides' };
    case 'topAndBottom':
      return { behindDocument: false, wrapLocalName: 'wrapTopAndBottom' };
    default: {
      const _exhaustive: never = target;
      void _exhaustive;
      return { behindDocument: false, wrapLocalName: 'wrapSquare', wrapText: 'bothSides' };
    }
  }
}

function sharedAnchorChildren(anchor: OoxmlElement): OoxmlNode[] {
  return anchor.children.filter((child) => isElement(child) && !isPositionOrWrapChild(child));
}

function preservedWrapGenerics(existing: OoxmlElement | null): OoxmlNode[] {
  if (!existing) return [];
  return existing.children.filter(
    (child) =>
      isElement(child) &&
      child.kind === 'generic' &&
      child.localName !== 'wrapPolygon' &&
      child.localName !== 'effectExtent'
  );
}

function wrapSchemaAttributes(
  wrapLocalName: ReturnType<typeof wrapTargetToAnchorSpec>['wrapLocalName'],
  spec: ReturnType<typeof wrapTargetToAnchorSpec>,
  existing: OoxmlElement | null
): OoxmlAttribute[] {
  const distances = existing
    ? readDistancesFromWrap(existing)
    : { top: 0, right: 0, bottom: 0, left: 0 };
  const attrs: OoxmlAttribute[] = (existing?.attributes ?? []).filter(
    (attribute) => attribute.namespaceUri !== ''
  );
  switch (wrapLocalName) {
    case 'wrapNone':
      break;
    case 'wrapSquare':
      attrs.push(
        attr('distT', String(distances.top)),
        attr('distB', String(distances.bottom)),
        attr('distL', String(distances.left)),
        attr('distR', String(distances.right))
      );
      if (spec.wrapText) attrs.push(attr('wrapText', spec.wrapText));
      break;
    case 'wrapTight':
    case 'wrapThrough':
      attrs.push(attr('distL', String(distances.left)), attr('distR', String(distances.right)));
      if (spec.wrapText) attrs.push(attr('wrapText', spec.wrapText));
      break;
    case 'wrapTopAndBottom':
      attrs.push(attr('distT', String(distances.top)), attr('distB', String(distances.bottom)));
      break;
  }
  return attrs;
}

function wrapElementForSpec(
  spec: ReturnType<typeof wrapTargetToAnchorSpec>,
  nextId: () => string,
  existing: OoxmlElement | null,
  anchor: OoxmlElement
): OoxmlElement {
  const attrs = wrapSchemaAttributes(spec.wrapLocalName, spec, existing);
  const kindMap = {
    wrapNone: 'drawingWrapNone',
    wrapSquare: 'drawingWrapSquare',
    wrapTight: 'drawingWrapTight',
    wrapThrough: 'drawingWrapThrough',
    wrapTopAndBottom: 'drawingWrapTopBottom',
  } as const;
  const children: OoxmlNode[] = [...preservedWrapGenerics(existing)];
  if (spec.wrapLocalName === 'wrapSquare' || spec.wrapLocalName === 'wrapTopAndBottom') {
    const effect =
      existing?.children.find(
        (child) =>
          isElement(child) &&
          (child.kind === 'drawingEffectExtent' ||
            (child.namespaceUri === WP_NAMESPACE_URI && child.localName === 'effectExtent'))
      ) ?? null;
    if (effect) children.unshift(effect);
  }
  if (spec.wrapLocalName === 'wrapTight' || spec.wrapLocalName === 'wrapThrough') {
    const { cx, cy } = readExtentEmu(anchor);
    children.unshift(rectangularWrapPolygon(cx, cy, nextId));
  }
  return {
    id: nextId(),
    kind: kindMap[spec.wrapLocalName],
    namespaceUri: WP_NAMESPACE_URI,
    localName: spec.wrapLocalName,
    prefix: 'wp',
    namespaceBindings: [],
    attributes: attrs,
    children,
  } as OoxmlElement;
}

function readDistancesFromWrap(wrap: OoxmlElement): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  const read = (name: string): number => Number(schemaAttributeValue(wrap.attributes, name) ?? '0');
  return { top: read('distT'), right: read('distR'), bottom: read('distB'), left: read('distL') };
}

function defaultPositionChildren(nextId: () => string, projection: DrawingProjection): OoxmlNode[] {
  const pos = projection.position;
  const horizontalFrame: DrawingHorizontalReferenceFrame = pos?.horizontal.relativeFrom ?? 'column';
  const verticalFrame = pos?.vertical.relativeFrom ?? 'paragraph';
  return [
    {
      id: nextId(),
      kind: 'drawingSimplePos',
      namespaceUri: WP_NAMESPACE_URI,
      localName: 'simplePos',
      prefix: 'wp',
      namespaceBindings: [],
      attributes: [attr('x', '0'), attr('y', '0')],
      children: [],
    } as OoxmlElement,
    {
      id: nextId(),
      kind: 'drawingPositionH',
      namespaceUri: WP_NAMESPACE_URI,
      localName: 'positionH',
      prefix: 'wp',
      namespaceBindings: [],
      attributes: [attr('relativeFrom', horizontalFrame)],
      children: [
        {
          id: nextId(),
          kind: 'drawingPositionOffset',
          namespaceUri: WP_NAMESPACE_URI,
          localName: 'posOffset',
          prefix: 'wp',
          namespaceBindings: [],
          attributes: [],
          children: [
            { id: nextId(), kind: 'textValue', value: String(pos?.horizontal.offsetEmu ?? 0) },
          ],
        } as OoxmlElement,
      ],
    } as OoxmlElement,
    {
      id: nextId(),
      kind: 'drawingPositionV',
      namespaceUri: WP_NAMESPACE_URI,
      localName: 'positionV',
      prefix: 'wp',
      namespaceBindings: [],
      attributes: [attr('relativeFrom', verticalFrame)],
      children: [
        {
          id: nextId(),
          kind: 'drawingPositionOffset',
          namespaceUri: WP_NAMESPACE_URI,
          localName: 'posOffset',
          prefix: 'wp',
          namespaceBindings: [],
          attributes: [],
          children: [
            { id: nextId(), kind: 'textValue', value: String(pos?.vertical.offsetEmu ?? 0) },
          ],
        } as OoxmlElement,
      ],
    } as OoxmlElement,
  ];
}

function orderedAnchorChildren(
  position: readonly OoxmlNode[],
  shared: readonly OoxmlNode[],
  wrap: OoxmlElement
): OoxmlNode[] {
  const pick = (...kinds: string[]) =>
    shared.find((child) => isElement(child) && kinds.includes(child.kind)) ??
    shared.find((child) => isElement(child) && kinds.includes(child.localName));
  const extent = pick('drawingExtent', 'extent');
  const effect = pick('drawingEffectExtent', 'effectExtent');
  const docPr = pick('drawingDocPr', 'docPr');
  const framePr = pick('drawingGraphicFramePr', 'cNvGraphicFramePr');
  const graphic = pick('drawingGraphic', 'graphic');
  const ordered = [...position];
  if (extent) ordered.push(extent);
  if (effect) ordered.push(effect);
  ordered.push(wrap);
  if (docPr) ordered.push(docPr);
  if (framePr) ordered.push(framePr);
  if (graphic) ordered.push(graphic);
  for (const child of shared) {
    if (!ordered.includes(child)) ordered.push(child);
  }
  return ordered;
}

function buildAnchoredRoot(
  inlineOrAnchor: OoxmlElement,
  spec: ReturnType<typeof wrapTargetToAnchorSpec>,
  projection: DrawingProjection,
  nextId: () => string
): OoxmlElement {
  const existingWrap = findWrapChild(inlineOrAnchor);
  const wrap = wrapElementForSpec(spec, nextId, existingWrap, inlineOrAnchor);
  const shared = sharedAnchorChildren(inlineOrAnchor);
  const position = defaultPositionChildren(nextId, projection);
  const inlineDistances =
    inlineOrAnchor.kind === 'inlineDrawing' || inlineOrAnchor.localName === 'inline'
      ? {
          top: Number(schemaAttributeValue(inlineOrAnchor.attributes, 'distT') ?? '0'),
          right: Number(schemaAttributeValue(inlineOrAnchor.attributes, 'distR') ?? '0'),
          bottom: Number(schemaAttributeValue(inlineOrAnchor.attributes, 'distB') ?? '0'),
          left: Number(schemaAttributeValue(inlineOrAnchor.attributes, 'distL') ?? '0'),
        }
      : { top: 0, right: 0, bottom: 0, left: 0 };
  const preservedAnchorAttrs = inlineOrAnchor.attributes.filter(
    (attribute) => attribute.namespaceUri !== ''
  );
  return {
    id: nextId(),
    kind: 'anchoredDrawing',
    namespaceUri: WP_NAMESPACE_URI,
    localName: 'anchor',
    prefix: 'wp',
    namespaceBindings: [],
    attributes: [
      attr('distT', String(inlineDistances.top)),
      attr('distB', String(inlineDistances.bottom)),
      attr('distL', String(inlineDistances.left)),
      attr('distR', String(inlineDistances.right)),
      attr('simplePos', schemaAttributeValue(inlineOrAnchor.attributes, 'simplePos') ?? '0'),
      attr('relativeHeight', String(projection.anchor?.relativeHeight ?? 251658240)),
      attr('behindDoc', spec.behindDocument ? '1' : '0'),
      attr('locked', schemaAttributeValue(inlineOrAnchor.attributes, 'locked') ?? '0'),
      attr('layoutInCell', schemaAttributeValue(inlineOrAnchor.attributes, 'layoutInCell') ?? '1'),
      attr('allowOverlap', schemaAttributeValue(inlineOrAnchor.attributes, 'allowOverlap') ?? '1'),
      ...preservedAnchorAttrs,
    ],
    children: orderedAnchorChildren(position, shared, wrap),
  } as OoxmlElement;
}

function buildInlineRoot(anchor: OoxmlElement, nextId: () => string): OoxmlElement {
  const shared = sharedAnchorChildren(anchor);
  const inlineDistances = {
    top: Number(schemaAttributeValue(anchor.attributes, 'distT') ?? '0'),
    right: Number(schemaAttributeValue(anchor.attributes, 'distR') ?? '0'),
    bottom: Number(schemaAttributeValue(anchor.attributes, 'distB') ?? '0'),
    left: Number(schemaAttributeValue(anchor.attributes, 'distL') ?? '0'),
  };
  return {
    id: nextId(),
    kind: 'inlineDrawing',
    namespaceUri: WP_NAMESPACE_URI,
    localName: 'inline',
    prefix: 'wp',
    namespaceBindings: [],
    attributes: [
      attr('distT', String(inlineDistances.top)),
      attr('distR', String(inlineDistances.right)),
      attr('distB', String(inlineDistances.bottom)),
      attr('distL', String(inlineDistances.left)),
    ],
    children: shared,
  } as OoxmlElement;
}

function convertWrap(
  drawing: OoxmlDrawingNode,
  anchor: OoxmlElement,
  projection: DrawingProjection,
  wrap: ImageWrapTarget,
  nextId: () => string
): OoxmlDrawingNode {
  if (wrap === 'inline') {
    if (projection.kind === 'inline') return drawing;
    const inlineRoot = buildInlineRoot(anchor, nextId);
    return replaceDrawingChild(drawing, anchor.id, inlineRoot);
  }
  if (projection.kind === 'inline') {
    const spec = wrapTargetToAnchorSpec(wrap);
    const anchored = buildAnchoredRoot(anchor, spec, projection, nextId);
    return replaceDrawingChild(drawing, anchor.id, anchored);
  }
  const spec = wrapTargetToAnchorSpec(wrap);
  const existingWrap = findWrapChild(anchor);
  const wrapNode = wrapElementForSpec(spec, nextId, existingWrap, anchor);
  let updatedAnchor = replaceNodeShallow(anchor, {
    attributes: setSchemaAttribute(anchor.attributes, 'behindDoc', spec.behindDocument ? '1' : '0'),
  });
  const withoutWrap = updatedAnchor.children.filter((child) => {
    if (!isElement(child)) return true;
    if (child.id === existingWrap?.id) return false;
    return !(
      child.kind === 'drawingWrapNone' ||
      child.kind === 'drawingWrapSquare' ||
      child.kind === 'drawingWrapTight' ||
      child.kind === 'drawingWrapThrough' ||
      child.kind === 'drawingWrapTopBottom' ||
      (child.namespaceUri === WP_NAMESPACE_URI && child.localName.startsWith('wrap'))
    );
  });
  const docPrIndex = withoutWrap.findIndex(
    (child) => isElement(child) && (child.kind === 'drawingDocPr' || child.localName === 'docPr')
  );
  const nextChildren = [...withoutWrap];
  nextChildren.splice(docPrIndex >= 0 ? docPrIndex : nextChildren.length, 0, wrapNode);
  updatedAnchor = replaceNodeShallow(updatedAnchor, { children: nextChildren });
  return replaceDrawingChild(drawing, anchor.id, updatedAnchor);
}

function findWrapChild(anchor: OoxmlElement): OoxmlElement | null {
  for (const child of anchor.children) {
    if (!isElement(child)) continue;
    if (
      child.kind === 'drawingWrapNone' ||
      child.kind === 'drawingWrapSquare' ||
      child.kind === 'drawingWrapTight' ||
      child.kind === 'drawingWrapThrough' ||
      child.kind === 'drawingWrapTopBottom' ||
      (child.namespaceUri === WP_NAMESPACE_URI && child.localName.startsWith('wrap'))
    ) {
      return child;
    }
  }
  return null;
}

function updateAxisPosition(
  anchor: OoxmlElement,
  kind: 'drawingPositionH' | 'drawingPositionV',
  localName: 'positionH' | 'positionV',
  relativeFrom: string | undefined,
  offsetEmu: number | undefined,
  nextId: () => string
): OoxmlElement {
  const axis =
    findDirectChild(anchor.children, { kind }) ??
    findDirectChild(anchor.children, { namespaceUri: WP_NAMESPACE_URI, localName });
  if (!axis) return anchor;
  let attrs = axis.attributes;
  if (relativeFrom) attrs = setSchemaAttribute(attrs, 'relativeFrom', relativeFrom);
  let children = [...axis.children];
  if (offsetEmu !== undefined) {
    children = children.filter(
      (child) =>
        !(
          isElement(child) &&
          (child.localName === 'posOffset' ||
            child.localName === 'align' ||
            child.kind === 'drawingPositionOffset' ||
            child.kind === 'drawingPositionAlign')
        )
    );
    children.push({
      id: nextId(),
      kind: 'drawingPositionOffset',
      namespaceUri: WP_NAMESPACE_URI,
      localName: 'posOffset',
      prefix: 'wp',
      namespaceBindings: [],
      attributes: [],
      children: [{ id: nextId(), kind: 'textValue', value: String(Math.round(offsetEmu)) }],
    } as OoxmlElement);
  }
  const updatedAxis = replaceNodeShallow(axis, { attributes: attrs, children });
  return replaceNodeShallow(anchor, {
    children: anchor.children.map((child) => (child.id === axis.id ? updatedAxis : child)),
  });
}

function updatePosition(
  anchor: OoxmlElement,
  position: DrawingPositionInput,
  nextId: () => string
): OoxmlElement {
  const simplePos = schemaAttributeValue(anchor.attributes, 'simplePos') === '1';
  if (simplePos) {
    const simple = findDirectChild(anchor.children, { kind: 'drawingSimplePos' });
    if (!simple) return anchor;
    let attrs = simple.attributes;
    if (position.horizontalEmu !== undefined) {
      attrs = setSchemaAttribute(attrs, 'x', String(Math.round(position.horizontalEmu)));
    }
    if (position.verticalEmu !== undefined) {
      attrs = setSchemaAttribute(attrs, 'y', String(Math.round(position.verticalEmu)));
    }
    const updated = replaceNodeShallow(simple, { attributes: attrs });
    return replaceNodeShallow(anchor, {
      children: anchor.children.map((child) => (child.id === simple.id ? updated : child)),
    });
  }
  let updated = anchor;
  if (position.horizontalEmu !== undefined || position.relativeToH) {
    updated = updateAxisPosition(
      updated,
      'drawingPositionH',
      'positionH',
      position.relativeToH,
      position.horizontalEmu,
      nextId
    );
  }
  if (position.verticalEmu !== undefined || position.relativeToV) {
    updated = updateAxisPosition(
      updated,
      'drawingPositionV',
      'positionV',
      position.relativeToV,
      position.verticalEmu,
      nextId
    );
  }
  return updated;
}

function withDrawingNamespaceBindings(drawing: OoxmlDrawingNode): OoxmlDrawingNode {
  const bindings = [
    { prefix: 'wp', namespaceUri: WP_NAMESPACE_URI },
    { prefix: 'a', namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI },
    { prefix: 'pic', namespaceUri: PIC_NAMESPACE_URI },
    { prefix: 'r', namespaceUri: RELATIONSHIPS_NAMESPACE_URI },
  ];
  const merged = [...drawing.namespaceBindings];
  for (const binding of bindings) {
    if (!merged.some((existing) => existing.prefix === binding.prefix)) merged.push(binding);
  }
  return replaceNodeShallow(drawing, { namespaceBindings: merged });
}

function replaceDrawingAnchor(
  part: OoxmlPart,
  drawing: OoxmlDrawingNode,
  anchor: OoxmlElement,
  op: DrawingTreeDocOp,
  options?: EditOptions
): TreeOpResult {
  const updatedDrawing = replaceNodeShallow(drawing, {
    children: drawing.children.map((child) =>
      child.id === anchor.id ? anchor : child
    ) as OoxmlDrawingNode['children'],
  });
  const replaced = replaceNode(part, drawing.id, updatedDrawing, options);
  return fromEdit(replaced, drawingEffect(part, drawing.id, op));
}

export function applyDrawingOp(
  part: OoxmlPart,
  op: DrawingTreeDocOp,
  options?: EditOptions
): TreeOpResult {
  const rejection = validateDrawingOp(part, op);
  if (rejection) return { ok: false, reason: rejection };

  const nextId = createNodeIdAllocator(part);

  switch (op.op) {
    case 'insertDrawing': {
      const paragraph = findNode(part, op.paragraphId) as OoxmlParagraphNode;
      // Tracked: the drawing's run goes into a `w:ins` through the SAME placement typed text
      // follows (own-insertion extension, relocation past struck words), so suggesting mode
      // proposes the picture rather than committing an unattributed edit. The drawing clones
      // inside the tracked mint — a second allocator over the same part would collide.
      if (op.revision) {
        let clonedId: string | null = null;
        const result = applyInsertTrackedRun(
          part,
          paragraph,
          op.offset,
          (mint) => {
            const cloned = withDrawingNamespaceBindings(
              cloneWithNewIds(op.drawing, mint) as OoxmlDrawingNode
            );
            clonedId = cloned.id;
            return buildTrackedNode(mint(), 'run', 'r', [], [cloned]);
          },
          op.revision,
          options
        );
        if (!result.ok) return result;
        // The tracked apply reports the text-lane effect; a drawing insert moves geometry
        // beyond the line, so it keeps the drawing op's own impact and created set.
        return {
          ...result,
          effect: {
            dirty: [paragraph.id, ...(clonedId !== null ? [clonedId] : [])],
            created: clonedId !== null ? [clonedId] : [],
            deleted: [],
            dependencyKeys: TEXT_DEPS,
            impact: drawingOpImpact(op),
          },
        };
      }
      const cloned = withDrawingNamespaceBindings(
        cloneWithNewIds(op.drawing, nextId) as OoxmlDrawingNode
      );
      const edited = insertRunPayloadAtOffset(part, paragraph, op.offset, [cloned], options);
      const effect: TreeOpEffect = {
        dirty: [paragraph.id, cloned.id],
        created: [cloned.id],
        deleted: [],
        dependencyKeys: TEXT_DEPS,
        impact: drawingOpImpact(op),
      };
      return fromEdit(edited, effect);
    }
    case 'deleteDrawing': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const paragraph = paragraphContainingNode(part, ctx.drawing.id);
      const effect: TreeOpEffect = {
        dirty: paragraph ? [paragraph.id, ctx.drawing.id] : [ctx.drawing.id],
        created: [],
        deleted: [ctx.drawing.id],
        dependencyKeys: TEXT_DEPS,
        impact: drawingOpImpact(op),
      };
      return fromEdit(removeNode(part, ctx.drawing.id, options), effect);
    }
    case 'replaceDrawingResource': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const updatedAnchor = updateBlipRelationship(ctx.anchor, op.relationshipId);
      return replaceDrawingAnchor(part, ctx.drawing, updatedAnchor, op, options);
    }
    case 'resizeDrawing': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const updatedAnchor = updateExtent(ctx.anchor, op.extentEmu.cx, op.extentEmu.cy);
      return replaceDrawingAnchor(part, ctx.drawing, updatedAnchor, op, options);
    }
    case 'cropDrawing': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const updatedAnchor = updateCrop(ctx.anchor, op.crop, nextId);
      return replaceDrawingAnchor(part, ctx.drawing, updatedAnchor, op, options);
    }
    case 'positionDrawing': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const updatedAnchor = updatePosition(ctx.anchor, op.position, nextId);
      return replaceDrawingAnchor(part, ctx.drawing, updatedAnchor, op, options);
    }
    case 'setDrawingWrap': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const updatedDrawing = convertWrap(ctx.drawing, ctx.anchor, ctx.projection, op.wrap, nextId);
      const replaced = replaceNode(part, ctx.drawing.id, updatedDrawing, options);
      return fromEdit(replaced, drawingEffect(part, ctx.drawing.id, op));
    }
    case 'setDrawingMetadata': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const updatedAnchor = updateDocPrMetadata(ctx.anchor, op.title, op.description, op.hyperlink);
      return replaceDrawingAnchor(part, ctx.drawing, updatedAnchor, op, options);
    }
    case 'setDrawingLocks': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const updatedAnchor = updateLocks(ctx.anchor, ctx.projection, op.locks, nextId);
      return replaceDrawingAnchor(part, ctx.drawing, updatedAnchor, op, options);
    }
    case 'transformDrawing': {
      const ctx = drawingContext(part, op.drawingNodeId);
      if (typeof ctx === 'string') return { ok: false, reason: ctx };
      const updatedAnchor = updateTransform(ctx.anchor, ctx.projection, op.action);
      return replaceDrawingAnchor(part, ctx.drawing, updatedAnchor, op, options);
    }
    default: {
      const _exhaustive: never = op;
      void _exhaustive;
      return { ok: false, reason: 'unknown-op' };
    }
  }
}

/** Whether an op is one of the drawing ops. Narrows the type. */
export function isDrawingTreeDocOp(op: TreeDocOp): op is DrawingTreeDocOp {
  return (
    op.op === 'insertDrawing' ||
    op.op === 'replaceDrawingResource' ||
    op.op === 'deleteDrawing' ||
    op.op === 'resizeDrawing' ||
    op.op === 'cropDrawing' ||
    op.op === 'positionDrawing' ||
    op.op === 'setDrawingWrap' ||
    op.op === 'setDrawingMetadata' ||
    op.op === 'setDrawingLocks' ||
    op.op === 'transformDrawing'
  );
}
