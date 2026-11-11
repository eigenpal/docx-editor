// Drawing ops whose resize of a DrawingML diagram also rescales the diagram's saved drawing
// part, as ONE package undo unit. Other DOCX applications lay the diagram out again for the
// new `wp:extent`; the saved drawing must follow, or this engine and applications that read
// it would paint the old layout in the new frame (`package/diagram-frame.ts`).

import { withRescaledDiagramDrawing } from '../package/diagram-frame.ts';
import { schemaAttributeValue } from '../package/ooxml-drawing-rules.ts';
import { WP_NAMESPACE_URI } from '../package/ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import type { StoryScope, TreePackageStore } from './tree-package-store.ts';
import { transactPackageImage, type ImageIntentResult } from './tree-package-images.ts';
import { diagramDrawingOf } from './tree-op-diagram-drawing.ts';
import type { DrawingTreeDocOp } from './tree-op-types.ts';

type Extent = { readonly cx: number; readonly cy: number };

function element(node: OoxmlNode | undefined): OoxmlElement | null {
  return node && node.kind !== 'textValue' ? node : null;
}

/** The `wp:extent` of a drawing's inline or anchor, or null. */
function extentOf(drawing: OoxmlElement): Extent | null {
  for (const child of drawing.children) {
    const anchor = element(child);
    if (!anchor) continue;
    const isAnchor =
      anchor.kind === 'inlineDrawing' ||
      anchor.kind === 'anchoredDrawing' ||
      (anchor.namespaceUri === WP_NAMESPACE_URI &&
        (anchor.localName === 'inline' || anchor.localName === 'anchor'));
    if (!isAnchor) continue;
    for (const grandchild of anchor.children) {
      const extent = element(grandchild);
      if (!extent) continue;
      if (
        extent.kind !== 'drawingExtent' &&
        !(extent.namespaceUri === WP_NAMESPACE_URI && extent.localName === 'extent')
      )
        continue;
      const cx = Number(schemaAttributeValue(extent.attributes, 'cx'));
      const cy = Number(schemaAttributeValue(extent.attributes, 'cy'));
      return Number.isFinite(cx) && Number.isFinite(cy) ? { cx, cy } : null;
    }
  }
  return null;
}

/** Whether `ops` resize a diagram of `part`, so they need {@link applyDrawingFrameOps}. */
export function resizesDiagram(part: OoxmlPart, ops: readonly DrawingTreeDocOp[]): boolean {
  return ops.some((op) => op.op === 'resizeDrawing' && diagramDrawingOf(part, op.drawingNodeId));
}

/**
 * Apply drawing ops in one package undo unit. Before each resize of a diagram, the diagram's
 * saved drawing part is rescaled from the frame it has to the frame the op gives it.
 */
export function applyDrawingFrameOps(
  store: TreePackageStore,
  scope: StoryScope,
  ops: readonly DrawingTreeDocOp[]
): ImageIntentResult {
  const first = ops.find((op) => 'drawingNodeId' in op);
  if (!first || !('drawingNodeId' in first)) return { ok: false, reason: 'invalidArgs' };
  // The id the unit reports, as the image lanes do; every op still names its own drawing.
  return transactPackageImage(store, scope, (ctx, owner) => {
    for (const op of ops) {
      if (op.op === 'resizeDrawing') {
        let failed = false;
        ctx.applyPackage((pkg) => {
          const part = pkg.parts.get(owner);
          const drawing = part ? diagramDrawingOf(part, op.drawingNodeId) : null;
          const from = drawing ? extentOf(drawing) : null;
          if (!drawing || !from) return pkg;
          const next = withRescaledDiagramDrawing(pkg, owner, drawing, from, op.extentEmu);
          if (next) return next;
          failed = true;
          return pkg;
        });
        if (failed) return null;
      }
      if (!ctx.apply(op)) return null;
    }
    return first.drawingNodeId;
  });
}
