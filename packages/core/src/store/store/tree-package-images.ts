// Package-wide image intents: insert, replace, delete, external embed (task 12).
//
// Each intent runs as one story transaction promoted to a package undo unit so media bytes,
// relationships, content types, and drawing XML commit or roll back together.

import { findNode, replaceNode } from '../package/ooxml-edit.ts';
import { withPart } from '../package/ooxml-package.ts';
import {
  projectDrawing,
  DEFAULT_DRAWING_PROJECTION_LIMITS,
  DEFAULT_SUPPORTED_MC_REQUIRES,
  createDrawingRelationshipResolver,
} from '../package/drawing-projection.ts';
import {
  buildInlinePictureDrawing,
  cleanupOrphanImageMedia,
  fetchExternalImageBytes,
  pointsToEmu,
  validateEmbeddedImageForCommit,
  withEmbeddedImage,
  type ExternalImageFetchPort,
} from '../package/drawing-package-edit.ts';
import {
  ensureHyperlinkRelationship,
  cleanupOrphanDrawingHyperlinkRelationship,
} from '../package/hyperlink-part.ts';
import { resolveImageRelationship } from '../package/relationships.ts';
import type { ImageDecodePort, SupportedImageMime } from '../package/image-resources.ts';
import type {
  OoxmlDrawingNode,
  OoxmlElement,
  OoxmlNode,
  OoxmlPart,
} from '../package/ooxml-tree.ts';
import { docPrHyperlinkRelationshipId, setDocPrHyperlinkRelationship } from './tree-op-drawings.ts';
import { paragraphOffsetIndex } from './tree-op-segments.ts';
import type { DrawingTreeDocOp, RevisionAttributionInput } from './tree-op-types.ts';
import type { PackageTransactResult, StoryScope, TreePackageStore } from './tree-package-store.ts';
import type { TransactionContext, TreeDocumentStore } from './tree-store.ts';

export interface InsertImageInput {
  readonly paragraphId: string;
  readonly offset: number;
  readonly bytes: Uint8Array;
  readonly mime: SupportedImageMime;
  readonly widthPoints: number;
  readonly heightPoints: number;
  readonly decodePort: ImageDecodePort;
  readonly expectedPackageRevision: number;
  readonly commitGuard?: () => boolean;
  readonly title?: string;
  readonly description?: string;
  readonly hyperlink?: string;
}

export interface ReplaceImageOptions {
  readonly expectedPackageRevision: number;
  readonly commitGuard?: () => boolean;
}

export type ImageIntentResult =
  | (Extract<PackageTransactResult, { ok: true }> & {
      readonly drawingNodeId?: string;
      readonly mediaPartName?: string;
    })
  | Extract<PackageTransactResult, { ok: false }>;

function imageIntentBlockedDuringComposition(
  store: TreePackageStore,
  storyStore: TreeDocumentStore
): ImageIntentResult | null {
  if (storyStore.compositionActive || store.compositionSessionOpen()) {
    return { ok: false, reason: 'invalidArgs', detail: 'ime-composition-active' };
  }
  return null;
}

function drawingAnchorOf(part: OoxmlPart, drawingNodeId: string): OoxmlElement | null {
  const drawing = findNode(part, drawingNodeId);
  if (!drawing || drawing.kind !== 'drawing') return null;
  const anchor = drawing.children.find(
    (child) => child.kind === 'inlineDrawing' || child.kind === 'anchoredDrawing'
  );
  return anchor ?? null;
}

function drawingProjection(
  pkg: ReturnType<TreePackageStore['currentPackage']>,
  ownerPartName: string,
  drawingNodeId: string
) {
  const targetPart = pkg.parts.get(ownerPartName);
  if (!targetPart) return null;
  const drawing = findNode(targetPart, drawingNodeId);
  if (!drawing || drawing.kind !== 'drawing') return null;
  return projectDrawing(drawing as OoxmlDrawingNode, {
    ownerPartName,
    supportedMcRequires: DEFAULT_SUPPORTED_MC_REQUIRES,
    limits: DEFAULT_DRAWING_PROJECTION_LIMITS,
    resolveRelationship: createDrawingRelationshipResolver(pkg, ownerPartName),
  });
}

function resolveEmbedMediaPart(
  pkg: ReturnType<TreePackageStore['currentPackage']>,
  ownerPartName: string,
  relationshipId: string
): string | null {
  const resolved = resolveImageRelationship(
    pkg.relationships.get(ownerPartName) ?? [],
    ownerPartName,
    relationshipId
  );
  return resolved.mode === 'internal' ? resolved.partName : null;
}

function transactPackageImage(
  store: TreePackageStore,
  scope: StoryScope,
  build: (ctx: TransactionContext, ownerPartName: string) => string | null,
  options?: { readonly expectedPackageRevision?: number; readonly commitGuard?: () => boolean }
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }

  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  const { store: storyStore, story } = resolved;
  const ownerPartName = story.partName;
  const beforePackage = store.currentPackage();
  const checkpoint = storyStore.checkpoint();
  const beforeDepth = storyStore.historyDepth;
  let drawingNodeId: string | null = null;
  let staleEpoch = false;
  let commitBlocked = false;

  const result = storyStore.transact(
    (ctx) => {
      if (options?.commitGuard?.() === false) {
        commitBlocked = true;
        return;
      }
      if (
        options?.expectedPackageRevision !== undefined &&
        store.packageRevision !== options.expectedPackageRevision
      ) {
        staleEpoch = true;
        return;
      }
      const id = build(ctx, ownerPartName);
      if (id === null) {
        ctx.apply({ op: 'insertText', paragraphId: '\0task12-abort', offset: 0, text: 'x' });
        return;
      }
      drawingNodeId = id;
    },
    {
      story,
      ...(story.kind === 'headerFooter' || story.kind === 'notesPart'
        ? { minimumImpact: 'global' as const }
        : {}),
    }
  );

  if (commitBlocked) {
    return { ok: false, reason: 'invalidArgs', detail: 'stale drawing selection' };
  }
  if (staleEpoch) {
    return { ok: false, reason: 'invalidArgs', detail: 'stale-package-epoch' };
  }

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      ...(result.detail ? { detail: result.detail } : {}),
    };
  }
  if (!result.change) return { ok: true, change: null };

  const createdDrawingId = result.change.created.find((id) => {
    const part = storyStore.part;
    const node = findNode(part, id);
    return node?.kind === 'drawing';
  });
  if (createdDrawingId) drawingNodeId = createdDrawingId;

  const change = store.promoteStoryTransactionToPackageUnit(
    beforePackage,
    storyStore,
    checkpoint,
    beforeDepth
  );

  return {
    ok: true,
    change,
    ...(drawingNodeId ? { drawingNodeId } : {}),
  };
}

function drawingHyperlinkRelationshipId(
  pkg: ReturnType<TreePackageStore['currentPackage']>,
  ownerPartName: string,
  drawingNodeId: string
): string | null {
  const targetPart = pkg.parts.get(ownerPartName);
  if (!targetPart) return null;
  const anchor = drawingAnchorOf(targetPart, drawingNodeId);
  if (!anchor) return null;
  return docPrHyperlinkRelationshipId(anchor);
}

function applyDrawingHyperlinkRel(
  ctx: TransactionContext,
  ownerPartName: string,
  drawingNodeId: string,
  relationshipId: string | null
): boolean {
  let ok = false;
  ctx.applyPackage((pkg) => {
    const part = pkg.parts.get(ownerPartName);
    if (!part) return pkg;
    const drawing = findNode(part, drawingNodeId);
    if (!drawing || drawing.kind !== 'drawing') return pkg;
    const anchor = drawingAnchorOf(part, drawingNodeId);
    if (!anchor) return pkg;
    const updatedAnchor = setDocPrHyperlinkRelationship(anchor, relationshipId);
    const updatedDrawing = replaceNodeShallowDrawing(drawing as OoxmlDrawingNode, updatedAnchor);
    const replaced = replaceNode(part, drawing.id, updatedDrawing, { deferValidation: true });
    if (!replaced.ok) return pkg;
    ok = true;
    return withPart(pkg, replaced.part);
  });
  return ok;
}

function replaceNodeShallowDrawing(
  drawing: OoxmlDrawingNode,
  updatedAnchor: OoxmlElement
): OoxmlDrawingNode {
  return {
    ...drawing,
    children: drawing.children.map((child) =>
      child.id === updatedAnchor.id ? updatedAnchor : child
    ) as OoxmlDrawingNode['children'],
  };
}

export async function insertImage(
  store: TreePackageStore,
  scope: StoryScope,
  input: InsertImageInput
): Promise<ImageIntentResult> {
  const cx = pointsToEmu(input.widthPoints);
  const cy = pointsToEmu(input.heightPoints);
  if (cx === null || cy === null) {
    return { ok: false, reason: 'invalidArgs', detail: 'invalid-dimensions' };
  }

  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  const ownerPartName = resolved.story.partName;
  const validated = await validateEmbeddedImageForCommit(input.decodePort, input.bytes, input.mime);
  if (!validated.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: 'invalid-image',
    };
  }
  const committedBytes = validated.bytes;

  const preflight = withEmbeddedImage(store.currentPackage(), ownerPartName, {
    bytes: committedBytes,
    mime: input.mime,
  });
  if (!preflight.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: preflight.reason === 'invalid-image' ? 'invalid-image' : preflight.reason,
    };
  }

  let createdMediaPart = preflight.partName;

  const outcome = transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      let pkg = store.currentPackage();
      const embedded = withEmbeddedImage(pkg, owner, { bytes: committedBytes, mime: input.mime });
      if (!embedded.ok) return null;
      pkg = embedded.pkg;
      createdMediaPart = embedded.partName;

      let hyperlinkRelationshipId: string | undefined;
      if (input.hyperlink) {
        const ensured = ensureHyperlinkRelationship(pkg, input.hyperlink, owner);
        if (!ensured) return null;
        pkg = ensured.pkg;
        hyperlinkRelationshipId = ensured.relationshipId;
      }

      if (!ctx.applyPackage(() => pkg)) return null;

      const drawing = buildInlinePictureDrawing({
        docPrId: embedded.docPrId,
        relationshipId: embedded.relationshipId,
        extentEmu: { cx, cy },
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(hyperlinkRelationshipId ? { hyperlinkRelationshipId } : {}),
      });

      if (
        !ctx.apply({
          op: 'insertDrawing',
          paragraphId: input.paragraphId,
          offset: input.offset,
          drawing: drawing as OoxmlDrawingNode,
        })
      ) {
        return null;
      }
      return drawing.id;
    },
    {
      expectedPackageRevision: input.expectedPackageRevision,
      ...(input.commitGuard ? { commitGuard: input.commitGuard } : {}),
    }
  );

  if (!outcome.ok) return outcome;
  if (!outcome.change) return { ok: true, change: null, mediaPartName: createdMediaPart };

  return {
    ...outcome,
    mediaPartName: createdMediaPart,
  };
}

export async function replaceImage(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  bytes: Uint8Array,
  mime: SupportedImageMime,
  decodePort: ImageDecodePort,
  options: ReplaceImageOptions
): Promise<ImageIntentResult> {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  const ownerPartName = resolved.story.partName;

  const validated = await validateEmbeddedImageForCommit(decodePort, bytes, mime);
  if (!validated.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: 'invalid-image',
    };
  }
  const committedBytes = validated.bytes;

  const preflight = withEmbeddedImage(store.currentPackage(), ownerPartName, {
    bytes: committedBytes,
    mime,
  });
  if (!preflight.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: preflight.reason === 'invalid-image' ? 'invalid-image' : preflight.reason,
    };
  }

  return transactPackageImage(
    store,
    scope,
    (ctx, owner) => {
      const pkg = store.currentPackage();
      const projection = drawingProjection(pkg, ownerPartName, drawingNodeId);
      const embedRel = projection?.picture?.embeddedRelationshipId ?? null;
      const linkRel = projection?.picture?.linkedRelationshipId ?? null;
      const previousRel = embedRel ?? linkRel;
      if (!previousRel) return null;
      const previousPart =
        embedRel !== null ? resolveEmbedMediaPart(pkg, ownerPartName, embedRel) : null;

      let next = pkg;
      const embedded = withEmbeddedImage(next, owner, { bytes: committedBytes, mime });
      if (!embedded.ok) return null;
      next = embedded.pkg;
      if (!ctx.applyPackage(() => next)) return null;
      if (
        !ctx.apply({
          op: 'replaceDrawingResource',
          drawingNodeId,
          relationshipId: embedded.relationshipId,
        })
      ) {
        return null;
      }
      ctx.applyPackage((current) =>
        cleanupOrphanImageMedia(current, owner, previousPart, previousRel)
      );
      return drawingNodeId;
    },
    {
      expectedPackageRevision: options.expectedPackageRevision,
      ...(options.commitGuard ? { commitGuard: options.commitGuard } : {}),
    }
  );
}

export function deleteImage(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  const ownerPartName = resolved.story.partName;
  const pkg = store.currentPackage();
  const projection = drawingProjection(pkg, ownerPartName, drawingNodeId);
  if (!projection) return { ok: false, reason: 'unknown-drawing' };
  const embedRel = projection.picture?.embeddedRelationshipId ?? null;
  const linkRel = projection.picture?.linkedRelationshipId ?? null;
  const previousRel = embedRel ?? linkRel;
  const previousPart =
    embedRel !== null ? resolveEmbedMediaPart(pkg, ownerPartName, embedRel) : null;

  return transactPackageImage(store, scope, (ctx, owner) => {
    if (!ctx.apply({ op: 'deleteDrawing', drawingNodeId })) return null;
    ctx.applyPackage((current) =>
      cleanupOrphanImageMedia(current, owner, previousPart, previousRel)
    );
    return drawingNodeId;
  });
}

/**
 * The drawing atom's model unit within its owning paragraph, from the SAME offset authority
 * the tracked ops strike by (`paragraphOffsetIndex`), so the proposal covers exactly the
 * unit `applyDeleteTracked` re-labels. Null when the drawing is not addressable content —
 * unknown id, or chrome swallowed by a field atom (zero-length span).
 */
function locateDrawingModelUnit(
  part: OoxmlPart,
  drawingNodeId: string
): { readonly paragraphId: string; readonly start: number; readonly end: number } | null {
  let found: { paragraphId: string; start: number; end: number } | null = null;
  const visit = (node: OoxmlNode): void => {
    if (found !== null || node.kind === 'textValue') return;
    if (node.kind === 'paragraph') {
      const span = paragraphOffsetIndex(node).spanOf(drawingNodeId);
      if (span !== null && span.end > span.start) {
        found = { paragraphId: node.id, start: span.start, end: span.end };
      }
      // No descent past the paragraph: a nested paragraph only exists inside a textbox
      // story, which is not an editable lane and publishes no selectable drawing.
      return;
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  return found;
}

/**
 * Propose the deletion instead of performing it: the drawing's single model unit goes into
 * a `w:del`, exactly as a struck word does, so the page keeps the picture (dimmed, outlined)
 * and the review queue offers one Accept. Media and relationships stay untouched — the file
 * still shows the picture until someone accepts — and the author's own pending insertion is
 * removed outright by the tracked apply, the same rule struck text follows.
 */
export function deleteImageTracked(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  revision: RevisionAttributionInput
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;
  const part = store.currentPackage().parts.get(resolved.story.partName);
  if (!part) return { ok: false, reason: 'unknown-drawing' };
  const located = locateDrawingModelUnit(part, drawingNodeId);
  if (!located) return { ok: false, reason: 'unknown-drawing' };
  return transactPackageImage(store, scope, (ctx) => {
    if (
      !ctx.apply({
        op: 'deleteText',
        paragraphId: located.paragraphId,
        start: located.start,
        end: located.end,
        revision,
      })
    ) {
      return null;
    }
    return drawingNodeId;
  });
}

export async function embedExternalImage(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  url: string,
  port: ExternalImageFetchPort,
  signal: AbortSignal,
  decodePort: ImageDecodePort
): Promise<ImageIntentResult> {
  const fetched = await fetchExternalImageBytes(port, url, signal, undefined, decodePort);
  if (!fetched.ok) {
    return {
      ok: false,
      reason: 'invalidArgs',
      detail: `${fetched.reason}${fetched.detail ? `:${fetched.detail}` : ''}`,
    };
  }

  return replaceImage(store, scope, drawingNodeId, fetched.bytes, fetched.mime, decodePort, {
    expectedPackageRevision: store.packageRevision,
  });
}

export function setDrawingMetadataWithHyperlink(
  store: TreePackageStore,
  scope: StoryScope,
  drawingNodeId: string,
  title: string,
  description: string,
  hyperlink: string | null
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  return transactPackageImage(store, scope, (ctx, owner) => {
    const previousHyperlinkRelId = drawingHyperlinkRelationshipId(
      store.currentPackage(),
      owner,
      drawingNodeId
    );
    let hyperlinkRelationshipId: string | null = null;
    if (hyperlink !== null) {
      const ensured = ensureHyperlinkRelationship(store.currentPackage(), hyperlink, owner);
      if (!ensured) return null;
      if (!ctx.applyPackage(() => ensured.pkg)) return null;
      hyperlinkRelationshipId = ensured.relationshipId;
    }

    if (
      !ctx.apply({
        op: 'setDrawingMetadata',
        drawingNodeId,
        title,
        description,
        ...(hyperlink === null ? { hyperlink: null } : {}),
      })
    ) {
      return null;
    }

    if (hyperlink !== null && hyperlinkRelationshipId !== null) {
      if (!applyDrawingHyperlinkRel(ctx, owner, drawingNodeId, hyperlinkRelationshipId))
        return null;
    } else if (hyperlink === null) {
      if (!applyDrawingHyperlinkRel(ctx, owner, drawingNodeId, null)) return null;
    }

    let cleanupFailed = false;
    ctx.applyPackage((current) => {
      const cleaned = cleanupOrphanDrawingHyperlinkRelationship(
        current,
        owner,
        previousHyperlinkRelId
      );
      if (cleaned === null) {
        cleanupFailed = true;
        return current;
      }
      return cleaned;
    });
    if (cleanupFailed) return null;

    return drawingNodeId;
  });
}

export interface ApplyImagePropertiesInput {
  readonly drawingNodeId: string;
  readonly ops: readonly DrawingTreeDocOp[];
  readonly hyperlink: string | null;
}

/** Atomic image properties including owner hyperlink relationship wiring. */
export function applyImagePropertiesIntent(
  store: TreePackageStore,
  scope: StoryScope,
  input: ApplyImagePropertiesInput
): ImageIntentResult {
  const resolved = store.resolveStory(scope);
  if (!resolved.ok) {
    return {
      ok: false,
      reason: resolved.reason,
      ...(resolved.detail ? { detail: resolved.detail } : {}),
    };
  }
  const blocked = imageIntentBlockedDuringComposition(store, resolved.store);
  if (blocked) return blocked;

  return transactPackageImage(store, scope, (ctx, owner) => {
    const previousHyperlinkRelId = drawingHyperlinkRelationshipId(
      store.currentPackage(),
      owner,
      input.drawingNodeId
    );
    let hyperlinkRelationshipId: string | null = null;
    if (input.hyperlink !== null) {
      const ensured = ensureHyperlinkRelationship(store.currentPackage(), input.hyperlink, owner);
      if (!ensured) return null;
      if (!ctx.applyPackage(() => ensured.pkg)) return null;
      hyperlinkRelationshipId = ensured.relationshipId;
    }

    for (const op of input.ops) {
      if (!ctx.apply(op)) return null;
    }

    if (
      !applyDrawingHyperlinkRel(
        ctx,
        owner,
        input.drawingNodeId,
        input.hyperlink === null ? null : hyperlinkRelationshipId
      )
    ) {
      return null;
    }

    let cleanupFailed = false;
    ctx.applyPackage((current) => {
      const cleaned = cleanupOrphanDrawingHyperlinkRelationship(
        current,
        owner,
        previousHyperlinkRelId
      );
      if (cleaned === null) {
        cleanupFailed = true;
        return current;
      }
      return cleaned;
    });
    if (cleanupFailed) return null;

    return input.drawingNodeId;
  });
}

export type { ExternalImageFetchPort };
