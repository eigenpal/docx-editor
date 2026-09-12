import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';
import { isParagraphMarkRevision } from '../store/store/tree-op-nodes.ts';
import { recordedProperties } from '../store/store/tree-op-tracked-properties.ts';
import { cacheProjection } from './bounded-projection-cache.ts';
import {
  revisionProjectionMode,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

const projections = new WeakMap<OoxmlElement, Map<string, OoxmlElement>>();

function named(node: OoxmlNode, name: string): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name
  );
}

/** Restore supported formatting records for display, keeping every canonical node untouched. */
export function projectRevisionFormatting(
  node: OoxmlElement,
  mode: RevisionDisplayMode,
  filter?: RevisionAuthorFilter,
  depth = 0
): OoxmlElement {
  if ((mode === 'all-markup' && !filter) || depth >= MAX_XML_DEPTH) return node;
  const key = `${mode}|${filter?.cacheKey ?? ''}`;
  const cached = projections.get(node)?.get(key);
  if (cached) return cached;
  let children: readonly OoxmlNode[] = node.children;
  const changeName = named(node, 'pPr') ? 'pPrChange' : named(node, 'rPr') ? 'rPrChange' : null;
  const change = changeName ? children.find((child) => named(child, changeName)) : undefined;
  if (change && change.kind !== 'textValue') {
    const attribute = (name: string): string =>
      change.attributes.find(
        (value) => value.namespaceUri === WML_NAMESPACE_URI && value.localName === name
      )?.value ?? '';
    const projection = filter
      ? revisionProjectionMode(
          filter,
          {
            kind: 'format',
            nodeId: change.id,
            id: attribute('id'),
            author: attribute('author'),
          },
          mode
        )
      : mode;
    const recorded = projection === 'original' ? recordedProperties(change) : null;
    if (projection === 'proposed') children = children.filter((child) => child !== change);
    if (recorded !== null) {
      if (changeName === 'pPrChange') {
        // CT_PPrBase records neither the paragraph mark nor the section break.
        children = [
          ...recorded.filter((child) => !named(child, 'rPr') && !named(child, 'sectPr')),
          ...children.filter((child) => named(child, 'rPr') || named(child, 'sectPr')),
        ];
      } else {
        // Mark insertion/deletion remains its own decision, independent of formatting.
        children = [
          ...children.filter(isParagraphMarkRevision),
          ...recorded.filter((child) => !isParagraphMarkRevision(child)),
        ];
      }
    }
  }
  let changed = children !== node.children;
  const projected = children.map((child) => {
    // A record describes history. Its nested properties are not live formatting decisions.
    if (child.kind === 'textValue' || child.localName.endsWith('PrChange')) return child;
    const result = projectRevisionFormatting(child, mode, filter, depth + 1);
    changed ||= result !== child;
    return result;
  });
  const result = changed ? ({ ...node, children: projected } as OoxmlElement) : node;
  let perView = projections.get(node);
  if (!perView) projections.set(node, (perView = new Map()));
  cacheProjection(perView, key, result);
  // A table's cell flow can encounter the projected subtree again.
  if (result !== node) {
    let projectedViews = projections.get(result);
    if (!projectedViews) projections.set(result, (projectedViews = new Map()));
    cacheProjection(projectedViews, key, result);
  }
  return result;
}
