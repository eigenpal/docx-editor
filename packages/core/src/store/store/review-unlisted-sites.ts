// The records a review queue leaves out, in the shape paint reads them.

import { revisionSiteNodeIdsOf, type ReviewItem } from './review-items.ts';

/** Change-element node ids and the paragraphs that hold them, for the items left out. */
export function unlistedSitesOf(items: readonly ReviewItem[]): {
  readonly sites: string[];
  readonly paragraphs: string[];
} {
  const sites: string[] = [];
  const paragraphs: string[] = [];
  for (const item of items) {
    if (item.kind !== 'revision') continue;
    for (const id of revisionSiteNodeIdsOf(item)) sites.push(id);
    for (const range of item.ranges) paragraphs.push(range.start.paragraphId);
  }
  return { sites, paragraphs };
}

const rootIds = new WeakMap<object, number>();
let nextRootId = 1;
const NO_ROOT = {};

function rootId(root: object | null): number {
  const key = root ?? NO_ROOT;
  let id = rootIds.get(key);
  if (id === undefined) {
    id = nextRootId++;
    rootIds.set(key, id);
  }
  return id;
}

/** A key that changes exactly when the styles or numbering root does. */
export function stylesAndNumberingKey(
  stylesRoot: object | null,
  numberingRoot: object | null
): string {
  return `${rootId(stylesRoot)}:${rootId(numberingRoot)}`;
}
