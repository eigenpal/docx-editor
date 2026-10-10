import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';
import { isParagraphMarkRevision } from '../store/store/tree-op-nodes.ts';
import { recordedProperties } from '../store/store/tree-op-tracked-properties.ts';
import { cacheProjection } from './bounded-projection-cache.ts';
import {
  paragraphMarkRevisionsOf,
  resolvedChangeSites,
  revisionIncluded,
  revisionProjectionMode,
  type RevisionAttribution,
  type RevisionAuthorFilter,
  type RevisionDisplayMode,
} from './revision-projection.ts';

const projections = new WeakMap<OoxmlElement, Map<string, OoxmlElement>>();

/**
 * The formatting change a resolved projection folded into a property element, keyed by the
 * PROJECTED element (the one the run and paragraph walks see). The view shows the accepted
 * formatting as plain, so nothing inline says a change happened; Simple Markup's change bar
 * still has to, and this is the only record left of it.
 */
const resolvedFormatChanges = new WeakMap<OoxmlElement, RevisionAttribution>();

/** The tracked formatting change a resolved view accepted into this `rPr` / `pPr`, if any. */
export function resolvedFormatChangeOf(
  properties: OoxmlNode | undefined
): RevisionAttribution | null {
  return properties && properties.kind !== 'textValue'
    ? (resolvedFormatChanges.get(properties) ?? null)
    : null;
}

function named(node: OoxmlNode, name: string): boolean {
  return (
    node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name
  );
}

/**
 * The mark decisions a resolved view answered on a paragraph — an inserted or removed break
 * the reviewer filter still shows, and the paragraph- and mark-property changes the view
 * accepted — for Simple Markup's change bar. Empty in All Markup.
 */
export function resolvedParagraphMarkChangeSites(
  paragraph: OoxmlNode,
  mode: RevisionDisplayMode,
  filter?: RevisionAuthorFilter
): readonly RevisionAttribution[] {
  if (mode === 'all-markup' || paragraph.kind === 'textValue') return [];
  const sites = [...resolvedChangeSites(paragraphMarkRevisionsOf(paragraph), mode, filter)];
  const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
  const paragraphChange = resolvedFormatChangeOf(pPr);
  if (paragraphChange) sites.push(paragraphChange);
  const rPr =
    pPr && pPr.kind !== 'textValue'
      ? pPr.children.find((child) => child.kind === 'runProperties')
      : undefined;
  const markChange = resolvedFormatChangeOf(rPr);
  if (markChange) sites.push(markChange);
  return sites;
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
  let resolvedChange: RevisionAttribution | null = null;
  const changeName = named(node, 'pPr') ? 'pPrChange' : named(node, 'rPr') ? 'rPrChange' : null;
  const change = changeName ? children.find((child) => named(child, changeName)) : undefined;
  if (change && change.kind !== 'textValue') {
    const attribute = (name: string): string =>
      change.attributes.find(
        (value) => value.namespaceUri === WML_NAMESPACE_URI && value.localName === name
      )?.value ?? '';
    const date = attribute('date');
    const attribution: RevisionAttribution = {
      kind: 'format',
      nodeId: change.id,
      id: attribute('id'),
      author: attribute('author'),
      ...(date === '' ? {} : { date }),
    };
    const projection = filter ? revisionProjectionMode(filter, attribution, mode) : mode;
    const recorded = projection === 'original' ? recordedProperties(change) : null;
    if (projection === 'proposed') children = children.filter((child) => child !== change);
    // A change the VIEW resolved is a site for Simple Markup; one the filter resolved is not.
    resolvedChange =
      projection === 'proposed' && (!filter || revisionIncluded(filter, attribution))
        ? attribution
        : null;
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
  if (resolvedChange) resolvedFormatChanges.set(result, resolvedChange);
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
