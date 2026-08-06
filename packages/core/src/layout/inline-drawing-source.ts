// Package-backed inline drawing layout source (typed-drawings-and-images task 6).
//
// Precomputes run-level drawing / MC atom projections from a bounded part traversal with
// ancestor xmlns bindings. Field projection consumes the atom-id map; it never re-walks MC
// with an empty namespace scope.

import type {
  OoxmlDrawingNode,
  OoxmlGenericElementNode,
  OoxmlNode,
  OoxmlParagraphNode,
  OoxmlPart,
} from '../store/package/ooxml-tree.ts';
import {
  createDrawingRelationshipResolver,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  indexInlineDrawingProjectionsInPart,
  isRunLevelMcAlternateContent,
  type DrawingProjection,
} from '../store/package/drawing-projection.ts';
import {
  imageResourceLookupFor,
  type ImageDecodePort,
  type ImageResourceLookup,
  type ImageResourceState,
  type ValidatedImageBytesHandle,
} from '../store/package/image-resources.ts';
import {
  mintValidatedImageBytes,
  releaseValidatedImageBytesToken,
  retainValidatedImageBytes,
  type ValidatedImageBytesReleaseToken,
} from '../store/package/validated-image-bytes.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';

/** Layout-owned read surface for inline drawing package state (no binding/session lane). */
export interface InlineDrawingPackageReader {
  packageRevision(): number;
  currentPackage(): OoxmlPackage;
  part(): OoxmlPart;
}

export interface InlineDrawingLayoutBundle {
  get bodyContext(): InlineDrawingLayoutContext;
  contextForPart(ownerPartName: string): InlineDrawingLayoutContext;
  /** Per-part resource epoch — only drawings owned by that part. */
  cacheTokenForPart(ownerPartName: string): string;
  drawingTokenForParagraph(paragraph: OoxmlNode, ownerPartName: string): string;
  /** Mint validated bytes for a ready handle when contentId matches; null on stale/mismatch. */
  mintValidatedBytes(
    handle: ValidatedImageBytesHandle,
    expectedContentId: string
  ): Uint8Array | null;
  sync(reader: InlineDrawingPackageReader): void;
  dispose(): void;
}

export interface CreateInlineDrawingLayoutBundleOptions {
  readonly session: InlineDrawingPackageReader;
  readonly decodePort: ImageDecodePort;
  readonly onResourcesChanged: () => void;
  /** Test-only override; production always uses {@link imageResourceLookupFor}. */
  readonly resourceLookup?: ImageResourceLookup;
}

function pendingResourceKey(projection: DrawingProjection): string {
  const picture = projection.picture;
  if (picture?.embeddedRelationshipId) {
    return `embed:${projection.ownerPartName}:${picture.embeddedRelationshipId}`;
  }
  if (picture?.linkedRelationshipId) {
    return `link:${projection.ownerPartName}:${picture.linkedRelationshipId}`;
  }
  return `nonpicture:${projection.drawingNodeId}`;
}

interface PartDrawingContextSlot {
  readonly context: InlineDrawingLayoutContext;
  readonly cacheTokenForPart: () => string;
  readonly drawingTokenForParagraph: (paragraph: OoxmlNode) => string;
  readonly isCompatibleWith: (part: OoxmlPart, pkg: OoxmlPackage) => boolean;
  readonly dispose: () => void;
}

function drawingAtomIdentities(part: OoxmlPart): ReadonlyMap<string, OoxmlNode> | null {
  const atoms = new Map<string, OoxmlNode>();
  const stack: { readonly node: OoxmlNode; readonly depth: number }[] = [
    { node: part.root, depth: 0 },
  ];
  let visited = 0;
  while (stack.length > 0) {
    const frame = stack.pop()!;
    visited += 1;
    if (
      visited > DEFAULT_DRAWING_PROJECTION_LIMITS.maxVisitedElements ||
      frame.depth > DEFAULT_DRAWING_PROJECTION_LIMITS.maxDrawingDepth
    ) {
      return null;
    }
    const { node } = frame;
    if (node.kind === 'drawing' || isRunLevelMcAlternateContent(node)) {
      atoms.set(node.id, node);
      continue;
    }
    if (!('children' in node)) continue;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: node.children[index]!, depth: frame.depth + 1 });
    }
  }
  return atoms;
}

function drawingProjectionLayoutToken(projection: DrawingProjection): string {
  const position = projection.position;
  const anchor = projection.anchor;
  const picture = projection.picture;
  const wrap = projection.wrapGeometry;
  return [
    projection.drawingNodeId,
    projection.ownerPartName,
    projection.kind,
    projection.hidden ? '1' : '0',
    String(projection.extentEmu.cx),
    String(projection.extentEmu.cy),
    String(projection.effectExtentEmu.top),
    String(projection.effectExtentEmu.right),
    String(projection.effectExtentEmu.bottom),
    String(projection.effectExtentEmu.left),
    projection.compatibilityBranchNodeId ?? '',
    anchor?.simplePos ? 'sp' : 'pv',
    anchor ? String(anchor.relativeHeight) : '',
    anchor ? (anchor.layoutInCell ? '1' : '0') : '',
    picture
      ? [
          String(picture.crop.left),
          String(picture.crop.top),
          String(picture.crop.right),
          String(picture.crop.bottom),
          String(picture.transform.rotationDegrees),
          picture.transform.flipHorizontal ? '1' : '0',
          picture.transform.flipVertical ? '1' : '0',
          String(picture.transform.offsetEmu.x),
          String(picture.transform.offsetEmu.y),
          String(picture.transform.extentEmu.cx),
          String(picture.transform.extentEmu.cy),
          picture.embeddedRelationshipId ?? '',
          picture.linkedRelationshipId ?? '',
          picture.presetGeometry ?? '',
        ].join(':')
      : '',
    wrap
      ? [
          wrap.element,
          wrap.textSide,
          String(wrap.distancesEmu.top),
          String(wrap.distancesEmu.right),
          String(wrap.distancesEmu.bottom),
          String(wrap.distancesEmu.left),
          String(wrap.polygon.length),
        ].join(':')
      : '',
    position
      ? [
          position.horizontal.relativeFrom,
          position.horizontal.align ?? '',
          String(position.horizontal.offsetEmu ?? ''),
          position.vertical.relativeFrom,
          position.vertical.align ?? '',
          String(position.vertical.offsetEmu ?? ''),
          String(position.simplePosition.xEmu),
          String(position.simplePosition.yEmu),
        ].join(':')
      : '',
  ].join('|');
}

function drawingResourceLayoutToken(resource: ImageResourceState): string {
  switch (resource.kind) {
    case 'ready':
      return `ready:${resource.resourceKey}:${resource.contentId}:${resource.pixelWidth}x${resource.pixelHeight}`;
    case 'pending':
      return `pending:${resource.resourceKey}`;
    case 'external':
      return `external:${resource.relationshipId}:${resource.sinkSafe ? '1' : '0'}`;
    case 'missing':
      return 'missing';
    case 'unrenderable':
      return `unrenderable:${resource.reason}`;
    default:
      return (resource as ImageResourceState).kind;
  }
}

/** Bound on text-box-in-text-box descent while building a paragraph's drawing token. */
const MAX_HOSTED_STORY_TOKEN_DEPTH = 4;

function collectDrawingAtoms(node: OoxmlNode, ids: string[]): void {
  if (node.kind === 'drawing' || isRunLevelMcAlternateContent(node)) {
    ids.push(node.id);
    return;
  }
  if ('children' in node) {
    for (const child of node.children) collectDrawingAtoms(child, ids);
  }
}

function drawingAtomsInParagraph(paragraph: OoxmlNode): readonly string[] {
  if (paragraph.kind !== 'paragraph') return [];
  const ids: string[] = [];
  for (const child of paragraph.children) collectDrawingAtoms(child, ids);
  return Object.freeze(ids);
}

function createPartDrawingContextSlot(options: {
  readonly ownerPartName: string;
  readonly part: OoxmlPart;
  readonly pkg: OoxmlPackage;
  readonly lookup: ImageResourceLookup;
  readonly onResourceSettled: (ownerPartName: string) => void;
  readonly rememberReadyHandle: (handle: ValidatedImageBytesHandle) => void;
  readonly forgetReadyHandle: (handle: ValidatedImageBytesHandle) => void;
}): PartDrawingContextSlot {
  const {
    ownerPartName,
    part,
    pkg,
    lookup,
    onResourceSettled,
    rememberReadyHandle,
    forgetReadyHandle,
  } = options;
  let disposed = false;
  let generation = 0;
  const resourceByKey = new Map<string, ImageResourceState>();
  const inFlight = new Set<string>();
  const resourceEpochByKey = new Map<string, number>();
  const drawingTokensByParagraph = new WeakMap<
    OoxmlNode,
    { readonly resourceEpoch: number; readonly token: string }
  >();
  let resourceEpoch = 0;

  const resolveRelationshipTarget = createDrawingRelationshipResolver(pkg, ownerPartName);
  const atomProjections = indexInlineDrawingProjectionsInPart(part, {
    resolveRelationship: resolveRelationshipTarget,
  });
  const atomIdentities = drawingAtomIdentities(part);

  const scheduleResolve = (projection: DrawingProjection, key: string): void => {
    if (disposed || inFlight.has(key)) return;
    inFlight.add(key);
    const startGeneration = generation;
    void lookup
      .resolveForProjection(projection)
      .then((state) => {
        if (disposed || startGeneration !== generation) return;
        resourceByKey.set(key, state);
        if (state.kind === 'ready') {
          rememberReadyHandle(state.validatedHandle);
        }
        resourceEpoch += 1;
        resourceEpochByKey.set(key, resourceEpoch);
        onResourceSettled(ownerPartName);
      })
      .catch(() => {
        if (disposed || startGeneration !== generation) return;
        resourceByKey.set(
          key,
          Object.freeze({
            kind: 'unrenderable',
            partName: null,
            mime: 'unknown',
            reason: 'decode-failed',
          })
        );
        resourceEpoch += 1;
        resourceEpochByKey.set(key, resourceEpoch);
        onResourceSettled(ownerPartName);
      })
      .finally(() => {
        inFlight.delete(key);
      });
  };

  const resourceOf = (projection: DrawingProjection): ImageResourceState => {
    const key = pendingResourceKey(projection);
    const cached = resourceByKey.get(key);
    if (cached) return cached;

    const linked = projection.picture?.linkedRelationshipId;
    if (linked) {
      const linkedState = lookup.resolveLinked(ownerPartName, linked);
      resourceByKey.set(key, linkedState);
      resourceEpoch += 1;
      resourceEpochByKey.set(key, resourceEpoch);
      return linkedState;
    }

    const pending = Object.freeze({
      kind: 'pending' as const,
      resourceKey: key,
    });
    resourceByKey.set(key, pending);
    resourceEpoch += 1;
    resourceEpochByKey.set(key, resourceEpoch);
    scheduleResolve(projection, key);
    return pending;
  };

  const projectionForAtom = (atomNodeId: string): DrawingProjection | null =>
    atomProjections.get(atomNodeId) ?? null;

  const context: InlineDrawingLayoutContext = Object.freeze({
    ownerPartName,
    projectionForAtom,
    project: (drawing: OoxmlDrawingNode) => projectionForAtom(drawing.id),
    resourceOf,
  });

  /**
   * Atom ids in the paragraph, plus the atoms of any text-box story they host.
   *
   * A text box's OWN resource is `unrenderable` — it is a shape, not a picture — and never
   * changes, so a picture inside it settling would move no token in the host paragraph's key
   * and repaint nothing. The story's atoms have to ride the host paragraph's key, because
   * that is what governs the break the story is laid out from.
   */
  const atomsWithHostedStories = (paragraph: OoxmlNode): readonly string[] => {
    const direct = drawingAtomsInParagraph(paragraph);
    let expanded: string[] | null = null;
    const visit = (atomIds: readonly string[], depth: number): void => {
      if (depth > MAX_HOSTED_STORY_TOKEN_DEPTH) return;
      for (const atomId of atomIds) {
        const story = atomProjections.get(atomId)?.textboxStory;
        if (!story) continue;
        const inner: string[] = [];
        collectDrawingAtoms(story.content, inner);
        if (inner.length === 0) continue;
        expanded ??= [...direct];
        expanded.push(...inner);
        visit(inner, depth + 1);
      }
    };
    visit(direct, 0);
    return expanded ?? direct;
  };

  const drawingTokenForParagraph = (paragraph: OoxmlNode): string => {
    const cached = drawingTokensByParagraph.get(paragraph);
    if (cached?.resourceEpoch === resourceEpoch) return cached.token;
    const atoms = atomsWithHostedStories(paragraph);
    if (atoms.length === 0) {
      drawingTokensByParagraph.set(paragraph, { resourceEpoch, token: '' });
      return '';
    }
    const tokens = atoms
      .map((atomId) => {
        const projection = atomProjections.get(atomId);
        if (!projection) return `${atomId}:refused`;
        const resource = resourceOf(projection);
        return [
          atomId,
          drawingProjectionLayoutToken(projection),
          drawingResourceLayoutToken(resource),
          String(resourceEpochByKey.get(pendingResourceKey(projection)) ?? 0),
        ].join('|');
      })
      .sort();
    const token = tokens.join(';');
    drawingTokensByParagraph.set(paragraph, { resourceEpoch, token });
    return token;
  };

  return {
    context,
    cacheTokenForPart: () =>
      `${ownerPartName}|${resourceEpoch}|${generation}|${atomProjections.size}`,
    drawingTokenForParagraph,
    isCompatibleWith: (nextPart, nextPkg) => {
      if (nextPart === part) return true;
      const nextAtomIdentities = drawingAtomIdentities(nextPart);
      if (atomIdentities && nextAtomIdentities && atomIdentities.size === nextAtomIdentities.size) {
        let unchanged = true;
        for (const [id, node] of atomIdentities) {
          if (nextAtomIdentities.get(id) !== node) {
            unchanged = false;
            break;
          }
        }
        if (unchanged) return true;
      }
      const nextProjections = indexInlineDrawingProjectionsInPart(nextPart, {
        resolveRelationship: createDrawingRelationshipResolver(nextPkg, ownerPartName),
      });
      if (nextProjections.size !== atomProjections.size) return false;
      for (const [atomId, projection] of atomProjections) {
        const next = nextProjections.get(atomId);
        if (
          !next ||
          drawingProjectionLayoutToken(next) !== drawingProjectionLayoutToken(projection)
        ) {
          return false;
        }
      }
      return true;
    },
    dispose: () => {
      disposed = true;
      generation += 1;
      for (const state of resourceByKey.values()) {
        if (state.kind === 'ready') forgetReadyHandle(state.validatedHandle);
      }
      resourceByKey.clear();
      inFlight.clear();
      resourceEpochByKey.clear();
    },
  };
}

export function createInlineDrawingLayoutBundle(
  options: CreateInlineDrawingLayoutBundleOptions
): InlineDrawingLayoutBundle {
  let pkgRevision = options.session.packageRevision();
  let pkgSnapshot = options.session.currentPackage();
  let lookup =
    options.resourceLookup ??
    imageResourceLookupFor(pkgSnapshot, {
      decodePort: options.decodePort,
    });
  const slots = new Map<string, PartDrawingContextSlot>();
  const partByName = new Map<string, OoxmlPart>();
  const handlesByKey = new Map<string, ValidatedImageBytesHandle>();
  const releaseTokensByKey = new Map<string, ValidatedImageBytesReleaseToken>();
  const rememberReadyHandle = (handle: ValidatedImageBytesHandle): void => {
    handlesByKey.set(handle.resourceKey, handle);
    const token = retainValidatedImageBytes(handle);
    if (token) releaseTokensByKey.set(handle.resourceKey, token);
  };
  const forgetReadyHandle = (handle: ValidatedImageBytesHandle): void => {
    handlesByKey.delete(handle.resourceKey);
    const token = releaseTokensByKey.get(handle.resourceKey);
    if (token) {
      releaseValidatedImageBytesToken(token);
      releaseTokensByKey.delete(handle.resourceKey);
    }
  };

  const resolvePart = (ownerPartName: string, reader: InlineDrawingPackageReader): OoxmlPart => {
    const pkg = reader.currentPackage();
    const existing = pkg.parts.get(ownerPartName) ?? partByName.get(ownerPartName);
    if (existing) return existing;
    if (ownerPartName === reader.part().name) return reader.part();
    throw new Error(`Missing inline drawing part ${ownerPartName}`);
  };

  const slotFor = (
    ownerPartName: string,
    reader: InlineDrawingPackageReader
  ): PartDrawingContextSlot => {
    const part = resolvePart(ownerPartName, reader);
    partByName.set(ownerPartName, part);
    let slot = slots.get(ownerPartName);
    if (slot) return slot;
    slot = createPartDrawingContextSlot({
      ownerPartName,
      part,
      pkg: reader.currentPackage(),
      lookup,
      onResourceSettled: () => options.onResourcesChanged(),
      rememberReadyHandle,
      forgetReadyHandle,
    });
    slots.set(ownerPartName, slot);
    return slot;
  };

  const resetPackage = (reader: InlineDrawingPackageReader): void => {
    const nextPkg = reader.currentPackage();
    const resourceSubstrateUnchanged =
      nextPkg.partBytes === pkgSnapshot.partBytes &&
      nextPkg.relationships === pkgSnapshot.relationships &&
      nextPkg.contentTypes === pkgSnapshot.contentTypes;
    if (resourceSubstrateUnchanged) {
      for (const [ownerPartName, slot] of slots) {
        const nextPart =
          nextPkg.parts.get(ownerPartName) ??
          (ownerPartName === reader.part().name ? reader.part() : undefined);
        if (nextPart && slot.isCompatibleWith(nextPart, nextPkg)) {
          partByName.set(ownerPartName, nextPart);
          continue;
        }
        slot.dispose();
        slots.delete(ownerPartName);
        partByName.delete(ownerPartName);
      }
      pkgRevision = reader.packageRevision();
      pkgSnapshot = nextPkg;
      return;
    }
    for (const slot of slots.values()) slot.dispose();
    slots.clear();
    partByName.clear();
    for (const token of releaseTokensByKey.values()) releaseValidatedImageBytesToken(token);
    releaseTokensByKey.clear();
    handlesByKey.clear();
    if (!options.resourceLookup) lookup.dispose();
    pkgRevision = reader.packageRevision();
    pkgSnapshot = nextPkg;
    lookup =
      options.resourceLookup ??
      imageResourceLookupFor(nextPkg, {
        decodePort: options.decodePort,
      });
  };

  return Object.freeze({
    get bodyContext() {
      return slotFor(options.session.part().name, options.session).context;
    },
    contextForPart(ownerPartName: string) {
      return slotFor(ownerPartName, options.session).context;
    },
    cacheTokenForPart(ownerPartName: string) {
      return slotFor(ownerPartName, options.session).cacheTokenForPart();
    },
    drawingTokenForParagraph(paragraph: OoxmlNode, ownerPartName: string) {
      return slotFor(ownerPartName, options.session).drawingTokenForParagraph(paragraph);
    },
    mintValidatedBytes(handle: ValidatedImageBytesHandle, expectedContentId: string) {
      const tracked = handlesByKey.get(handle.resourceKey);
      if (!tracked || tracked.contentId !== handle.contentId) return null;
      return mintValidatedImageBytes(handle, expectedContentId);
    },
    sync(reader: InlineDrawingPackageReader) {
      if (reader.packageRevision() === pkgRevision) return;
      resetPackage(reader);
    },
    dispose() {
      for (const slot of slots.values()) slot.dispose();
      slots.clear();
      partByName.clear();
      for (const token of releaseTokensByKey.values()) releaseValidatedImageBytesToken(token);
      releaseTokensByKey.clear();
      handlesByKey.clear();
      if (!options.resourceLookup) lookup.dispose();
    },
  });
}

/** @deprecated Prefer {@link createInlineDrawingLayoutBundle}. */
export type InlineDrawingLayoutInput = InlineDrawingLayoutBundle;

/** @deprecated Prefer {@link createInlineDrawingLayoutBundle}. */
export const createInlineDrawingLayoutInput = createInlineDrawingLayoutBundle;

/** Whether a run child may carry an inline drawing atom. */
export function isInlineDrawingRunAtom(
  node: OoxmlNode
): node is OoxmlDrawingNode | OoxmlGenericElementNode {
  return node.kind === 'drawing' || isRunLevelMcAlternateContent(node);
}

/** Paragraph-local drawing cache token from a layout context (tests / headless callers). */
export function paragraphDrawingLayoutTokenFromContext(
  paragraph: OoxmlParagraphNode,
  context: InlineDrawingLayoutContext
): string {
  const atoms = drawingAtomsInParagraph(paragraph);
  if (atoms.length === 0) return '';
  return atoms
    .map((atomId) => {
      const projection = context.projectionForAtom?.(atomId);
      if (!projection) return `${atomId}:refused`;
      const resource = context.resourceOf(projection);
      return [
        atomId,
        drawingProjectionLayoutToken(projection),
        drawingResourceLayoutToken(resource),
      ].join('|');
    })
    .sort()
    .join(';');
}

/** Aggregate per-paragraph drawing tokens for a table subtree (cache + incremental keys). */
export function drawingTokenForTableBlock(
  table: OoxmlNode,
  drawingTokenForParagraph: (paragraph: OoxmlNode) => string
): string {
  const tokens: string[] = [];
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') {
      const token = drawingTokenForParagraph(node);
      if (token) tokens.push(token);
      return;
    }
    if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(table);
  return tokens.sort().join(';');
}

export { drawingProjectionLayoutToken, drawingResourceLayoutToken };
