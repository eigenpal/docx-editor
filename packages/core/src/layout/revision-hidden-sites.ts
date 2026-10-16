// Paint no markup for revision records the review queue leaves out.
//
// A property change that resolves to the same formatting has no review card, so its paragraph
// gets no change bar and its text no format mark either. The filter carries the records as data:
// only the paragraphs that hold one project without it, and every other block keeps the
// unfiltered fast path, because a selecting filter projects the whole story. The cache key
// names the records, so a block cached with them left out is never served as the canonical one.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { EMPTY_REVISION_AUTHOR_SET, type RevisionAuthorFilter } from './revision-projection.ts';
import { MAX_XML_DEPTH } from '../store/package/xml-reader.ts';

/** Records with no card, by change-element node id, and the paragraphs that hold them. */
export type UnlistedRevisionSites = NonNullable<RevisionAuthorFilter['unlisted']>;

const composed = new WeakMap<object, WeakMap<UnlistedRevisionSites, RevisionAuthorFilter>>();
const NO_FILTER = {};

/**
 * `base` carrying `unlisted`, the same object for the same pair, or `base` itself when there is
 * nothing to leave out.
 *
 * The cache key names the styles and numbering the records were decided against, not the
 * records: the key keeps a block cached with them left out apart from the canonical block, and
 * moves when a style or list edit can change which records are left out without changing their
 * paragraphs. Any other change to the records comes with a new paragraph node, so a key over
 * the records themselves only relaid the whole document out when a paragraph split copied one.
 */
export function withHiddenRevisionSites(
  base: RevisionAuthorFilter | undefined,
  unlisted: UnlistedRevisionSites
): RevisionAuthorFilter | undefined {
  if (unlisted.sites.size === 0) return base;
  const byUnlisted = composed.get(base ?? NO_FILTER) ?? new WeakMap();
  composed.set(base ?? NO_FILTER, byUnlisted);
  let filter = byUnlisted.get(unlisted);
  if (!filter) {
    filter = Object.freeze({
      ...(base ?? { hiddenAuthors: EMPTY_REVISION_AUTHOR_SET }),
      cacheKey: `${base?.cacheKey ?? ''}|unlisted:${unlisted.key}`,
      unlisted,
    });
    byUnlisted.set(unlisted, filter);
  }
  return filter;
}

const stripped = new WeakMap<OoxmlNode, { sites: ReadonlySet<string>; result: OoxmlNode }>();

function isUnlistedChange(node: OoxmlNode, sites: ReadonlySet<string>): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    (node.localName === 'pPrChange' || node.localName === 'rPrChange') &&
    sites.has(node.id)
  );
}

function strip(node: OoxmlNode, sites: ReadonlySet<string>, depth: number): OoxmlNode {
  if (node.kind === 'textValue' || depth >= MAX_XML_DEPTH) return node;
  let children: OoxmlNode[] | null = null;
  node.children.forEach((child, index) => {
    const next = isUnlistedChange(child, sites) ? null : strip(child, sites, depth + 1);
    if (next === child) {
      children?.push(child);
      return;
    }
    children ??= node.children.slice(0, index);
    if (next) children.push(next);
  });
  return children ? ({ ...node, children } as OoxmlElement) : node;
}

/** `block` without the unlisted records it holds, or `block` itself when it holds none. */
export function withoutUnlistedChanges<T extends OoxmlNode>(
  block: T,
  filter: RevisionAuthorFilter | undefined
): T {
  const unlisted = filter?.unlisted;
  if (!unlisted || block.kind !== 'paragraph' || !unlisted.paragraphs.has(block.id)) return block;
  const sites = unlisted.sites;
  const known = stripped.get(block);
  if (known && known.sites === sites) return known.result as T;
  const result = strip(block, sites, 0) as T;
  stripped.set(block, { sites, result });
  return result;
}
