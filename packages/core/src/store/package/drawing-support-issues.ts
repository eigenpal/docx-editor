import { drawingRenderers } from './drawing-renderers.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI as A, type OoxmlElement } from './ooxml-tree.ts';

/** A source-addressed drawing limitation. This is not a complete fidelity assessment. @public */
export interface DrawingSupportIssue {
  readonly code:
    | 'unsupported-effect'
    | 'renderer-required'
    | 'unverified-3d'
    | 'saved-fallback'
    | 'unplaced-drawing'
    | 'inspection-limit'
    | 'projection-diagnostic';
  readonly nodeId: string;
  readonly namespaceUri: string;
  readonly localName: string;
  /** Stable feature identifier, or the projection diagnostic code. */
  readonly detail: string;
}

const BLIP_EFFECTS = new Set(['alphaModFix', 'biLevel', 'grayscl', 'lum', 'extLst']);
const OPTIONAL_EFFECTS = new Set(['glow', 'innerShdw', 'reflection', 'softEdge']);
const UNSUPPORTED_EFFECTS = new Set(['blur', 'fillOverlay', 'prstShdw']);
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

export function supportIssue(
  node: OoxmlElement,
  code: DrawingSupportIssue['code'],
  detail: string
): DrawingSupportIssue {
  return Object.freeze({
    code,
    nodeId: node.id,
    namespaceUri: node.namespaceUri,
    localName: node.localName,
    detail,
  });
}

/** Find the displayed drawing and its compatibility branch without scanning unrelated parts. */
export function drawingSourceSelection(
  source: OoxmlElement,
  drawingNodeId: string
): {
  readonly node: OoxmlElement;
  readonly fallback: boolean;
  readonly complete: boolean;
} {
  const stack = [{ node: source, fallback: false }];
  let visited = 0;
  while (stack.length && ++visited <= 4096) {
    const item = stack.pop()!;
    if (item.node.id === drawingNodeId) return { ...item, complete: true };
    for (const child of item.node.children) {
      if (child.kind === 'textValue') continue;
      stack.push({
        node: child,
        fallback: item.fallback || (child.namespaceUri === MC && child.localName === 'Fallback'),
      });
    }
  }
  return { node: source, fallback: false, complete: stack.length === 0 };
}

/** Inspect explicit effects in the selected source. Theme and related-part contents are not assessed. */
export function drawingSourceIssues(
  source: OoxmlElement,
  drawingNodeId: string
): readonly DrawingSupportIssue[] {
  const selected = drawingSourceSelection(source, drawingNodeId);
  const issues: DrawingSupportIssue[] = [];
  if (!selected.complete)
    issues.push(supportIssue(source, 'inspection-limit', 'drawing-selection-budget'));
  if (selected.fallback) issues.push(supportIssue(source, 'saved-fallback', 'mc:Fallback'));
  const stack = [{ node: selected.node, parent: '', depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { node, parent, depth } = stack.pop()!;
    if (++visited > 4096 || depth > 64) {
      issues.push(supportIssue(node, 'inspection-limit', 'drawing-source-budget'));
      break;
    }
    // Nested stories have their own drawing occurrences. Do not diagnose an inactive MC branch.
    if (node.namespaceUri === W && node.localName === 'txbxContent') continue;
    if (node.namespaceUri === MC && node.localName === 'AlternateContent') continue;
    if (node.namespaceUri === A) {
      if (
        node.localName === 'effectDag' ||
        (parent === 'blip' && !BLIP_EFFECTS.has(node.localName)) ||
        (parent === 'effectLst' && UNSUPPORTED_EFFECTS.has(node.localName))
      ) {
        issues.push(supportIssue(node, 'unsupported-effect', `a:${node.localName}`));
      } else if (
        parent === 'effectLst' &&
        OPTIONAL_EFFECTS.has(node.localName) &&
        !drawingRenderers().effects
      ) {
        issues.push(supportIssue(node, 'renderer-required', `a:${node.localName}`));
      } else if (node.localName === 'scene3d' || node.localName === 'sp3d') {
        issues.push(supportIssue(node, 'unverified-3d', `a:${node.localName}`));
      }
    } else if (
      node.namespaceUri === 'http://schemas.microsoft.com/office/drawing/2010/main' &&
      node.localName === 'imgProps'
    ) {
      issues.push(supportIssue(node, 'unsupported-effect', 'a14:imgProps'));
    }
    for (let index = node.children.length - 1; index >= 0; index--) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue')
        stack.push({
          node: child,
          parent: node.namespaceUri === A ? node.localName : '',
          depth: depth + 1,
        });
    }
  }
  return Object.freeze(issues);
}
