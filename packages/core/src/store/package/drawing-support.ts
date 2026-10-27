import { stylesPartOf } from './ooxml-indexes.ts';
import { createPackageShapeThemeResolvers } from './theme-color-resolution.ts';
import { createDiagramPartResolver } from './diagram-parts.ts';
import {
  projectDrawingsInPart,
  createDrawingRelationshipResolver,
  type DrawingProjection,
} from './drawing-projection.ts';
import {
  drawingSourceIssues,
  drawingSourceSelection,
  supportIssue,
  type DrawingSupportIssue,
} from './drawing-support-issues.ts';
import { drawingGraphicKind, type DrawingGraphicKind } from './drawing-graphic-kind.ts';
import type { OoxmlPackage } from './ooxml-package.ts';
import type { OoxmlElement } from './ooxml-tree.ts';

export type { DrawingSupportIssue } from './drawing-support-issues.ts';
export type { DrawingGraphicKind } from './drawing-graphic-kind.ts';

/** Source inspection before image decoding or pagination. `projected` does not mean full fidelity. @public */
export interface DrawingSupportEntry {
  readonly ownerPartName: string;
  /** Source identity for this snapshot; not a persistent XML identifier. */
  readonly nodeId: string;
  /** Selected projection identity, when one exists. */
  readonly drawingNodeId: string | null;
  readonly state: 'projected' | 'fallback' | 'placeholder' | 'hidden' | 'unplaced';
  /** The graphic the selected drawing holds, whether or not it renders. */
  readonly graphicKind: DrawingGraphicKind;
  /** The original canonical drawing or enclosing compatibility wrapper. Never mutate this value. */
  readonly source: OoxmlElement;
  readonly issues: readonly DrawingSupportIssue[];
}

/** A bounded inventory of story drawings, including drawings without layout geometry. @public */
export interface DrawingSupportReport {
  readonly entries: readonly DrawingSupportEntry[];
  /** False when a scan budget prevented a complete inventory. */
  readonly complete: boolean;
  /** This report checks explicit source effects, not every DrawingML feature or related part. */
  readonly coverage: 'explicit-source-effects';
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const STORIES = new Set(['document', 'hdr', 'ftr', 'footnotes', 'endnotes']);
const DRAWINGS = new Set(['drawing', 'pict', 'object']);

function stateOf(
  projection: DrawingProjection | undefined,
  fallback: boolean
): DrawingSupportEntry['state'] {
  if (!projection) return 'unplaced';
  if (projection.hidden || projection.footprintOnly) return 'hidden';
  if (projection.chartSummary?.shownAs === 'fallback' || fallback) return 'fallback';
  if (
    projection.picture ||
    projection.vectorShape ||
    projection.groupPicture ||
    projection.textboxStory ||
    projection.textArt ||
    projection.legacyGraphic ||
    projection.horizontalRule ||
    projection.groupTextboxes?.length
  )
    return 'projected';
  return 'placeholder';
}

/**
 * Inspect story drawings without opening a DOM, decoding images, or loading external resources.
 * Pass a parsed package from the same saved snapshot you send to your rendering service.
 * A complete inventory is not a complete fidelity assessment. Related chart, diagram, and theme
 * contents, inactive alternatives, and final image decoding need separate checks.
 * @public
 */
export function inspectDrawingSupport(pkg: OoxmlPackage): DrawingSupportReport {
  const theme = createPackageShapeThemeResolvers(pkg);
  const entries: DrawingSupportEntry[] = [];
  let complete = true;
  let visited = 0;
  for (const part of pkg.parts.values()) {
    if (part.root.namespaceUri !== W || !STORIES.has(part.root.localName)) continue;
    const projections = new Map(
      projectDrawingsInPart(part, {
        stylesPart: stylesPartOf(pkg),
        resolveRelationship: createDrawingRelationshipResolver(pkg, part.name),
        resolveSchemeColor: theme.resolveSchemeColor,
        resolveStyleMatrixReference: theme.resolveStyleMatrixReference,
        resolveDiagramParts: createDiagramPartResolver(pkg, part.name),
      }).map((projection) => [`${part.name}\0${projection.drawingNodeId}`, projection])
    );
    const stack: { node: OoxmlElement; depth: number }[] = [{ node: part.root, depth: 0 }];
    const sources = new Map<OoxmlElement, DrawingProjection | undefined>();
    while (stack.length) {
      const { node, depth } = stack.pop()!;
      if (++visited > 1_000_000 || depth > 128) {
        complete = false;
        break;
      }
      const isDrawing = node.namespaceUri === W && DRAWINGS.has(node.localName);
      const isAlternative = node.namespaceUri === MC && node.localName === 'AlternateContent';
      if (isDrawing || isAlternative) {
        let projection = projections.get(`${part.name}\0${node.id}`);
        let hasDrawing = isDrawing;
        const candidates: OoxmlElement[] = [node];
        let count = 0;
        while (candidates.length) {
          const candidate = candidates.pop()!;
          if (++count > 4096 || ++visited > 1_000_000) {
            complete = false;
            break;
          }
          if (candidate.namespaceUri === W && candidate.localName === 'txbxContent') continue;
          hasDrawing ||= candidate.namespaceUri === W && DRAWINGS.has(candidate.localName);
          projection ??= projections.get(`${part.name}\0${candidate.id}`);
          for (const child of candidate.children)
            if (child.kind !== 'textValue') candidates.push(child);
        }
        if (hasDrawing) sources.set(node, projection);
        // Only selected text-box stories contribute independent drawing occurrences.
        if (projection) {
          const selected = drawingSourceSelection(node, projection.drawingNodeId).node;
          const descendants = [selected];
          let storyVisited = 0;
          while (descendants.length && ++storyVisited <= 4096 && ++visited <= 1_000_000) {
            const child = descendants.pop()!;
            if (child.namespaceUri === W && child.localName === 'txbxContent') {
              stack.push({ node: child, depth: depth + 1 });
              continue;
            }
            for (const nested of child.children)
              if (nested.kind !== 'textValue') descendants.push(nested);
          }
          if (descendants.length) complete = false;
        }
        continue;
      }
      for (let index = node.children.length - 1; index >= 0; index--) {
        const child = node.children[index]!;
        if (child.kind !== 'textValue') stack.push({ node: child, depth: depth + 1 });
      }
    }
    for (const [source, projection] of sources) {
      const selected = drawingSourceSelection(source, projection?.drawingNodeId ?? source.id);
      const issues = [...drawingSourceIssues(source, projection?.drawingNodeId ?? source.id)];
      if (!projection)
        issues.push(supportIssue(source, 'unplaced-drawing', 'no-layout-projection'));
      for (const diagnostic of projection?.diagnostics ?? []) {
        issues.push(
          Object.freeze({
            ...supportIssue(selected.node, 'projection-diagnostic', diagnostic.code),
            nodeId: diagnostic.nodeId,
          })
        );
      }
      if (issues.some((issue) => issue.code === 'inspection-limit')) complete = false;
      entries.push(
        Object.freeze({
          ownerPartName: part.name,
          nodeId: source.id,
          drawingNodeId: projection?.drawingNodeId ?? null,
          state: stateOf(projection, selected.fallback),
          graphicKind: drawingGraphicKind(selected.node),
          source,
          issues: Object.freeze(issues),
        })
      );
    }
    if (!complete && visited > 1_000_000) break;
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    complete,
    coverage: 'explicit-source-effects',
  });
}
