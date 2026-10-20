import { parentNodeOf } from '../package/ooxml-edit.ts';
import type { OoxmlElement, OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../package/ooxml-tree.ts';
import { followingSiblingParagraphs } from './review-paragraph-breaks.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from './review-items.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

const canonical = (node: OoxmlNode): unknown =>
  node.kind === 'textValue'
    ? node.value
    : [
        node.namespaceUri,
        node.localName,
        node.attributes
          .map((a) => [a.namespaceUri, a.localName, a.value])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        node.children.map(canonical),
      ];
const properties = (node: OoxmlElement) =>
  new Map(
    node.children
      .filter(
        (child) =>
          child.kind !== 'textValue' &&
          !(child.namespaceUri === WML_NAMESPACE_URI && child.localName === 'rPrChange')
      )
      .map((child) =>
        child.kind === 'textValue'
          ? ['', '']
          : [
              JSON.stringify([child.namespaceUri, child.localName]),
              JSON.stringify(canonical(child)),
            ]
      )
  );

/** Compare the formatting delta, including properties not exposed by UI summaries. */
function signature(site: RevisionSite, withMarks = false): string | undefined {
  if (
    site.node.localName !== 'rPrChange' ||
    !site.parent ||
    (site.paragraphMark && !withMarks) ||
    site.refused
  )
    return;
  const previous = site.node.children.find(
    (node) =>
      node.kind !== 'textValue' &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      node.localName === 'rPr'
  );
  if (!previous || previous.kind === 'textValue') return;
  const before = properties(previous);
  const after = properties(site.parent);
  const changes = [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((key) => before.get(key) !== after.get(key))
    .map((key) => [key, after.get(key) ?? null]);
  return changes.length ? JSON.stringify(changes) : undefined;
}

export function groupAdjacentRunFormatting(
  items: readonly ReviewRevisionItem[],
  sites: readonly RevisionSite[]
): ReviewRevisionItem[] {
  const signatures = new Map(sites.map((site) => [site.node.id, signature(site)]));
  const buckets = new Map<string, ReviewRevisionItem[]>();
  for (const item of items) {
    if (
      item.revisionKind !== 'format' ||
      item.formattingKind !== 'rPrChange' ||
      item.readOnly ||
      item.ranges.length !== 1
    )
      continue;
    const range = item.ranges[0]!;
    if (
      range.start.paragraphId !== range.end.paragraphId ||
      range.start.offset === range.end.offset
    )
      continue;
    const ids = revisionSiteNodeIdsOf(item);
    const change = ids.length ? signatures.get(ids[0]!) : undefined;
    if (!change || !ids.every((id) => signatures.get(id) === change)) continue;
    const key = JSON.stringify([item.author, range.partName, range.start.paragraphId, change]);
    const bucket = buckets.get(key) ?? [];
    bucket.push(item);
    buckets.set(key, bucket);
  }
  const consumed = new Set<ReviewRevisionItem>();
  const replacements = new Map<ReviewRevisionItem, ReviewRevisionItem>();
  const close = (chain: ReviewRevisionItem[]) => {
    if (chain.length < 2) return;
    const first = chain[0]!;
    const addresses = [
      ...new Map(
        chain
          .flatMap((item) => item.addresses)
          .map((address) => [
            JSON.stringify([address.id, address.author, address.date ?? null]),
            address,
          ])
      ).values(),
    ];
    replacements.set(
      first,
      registerRevisionSiteNodeIds(
        {
          ...first,
          addresses,
          ranges: chain.flatMap((item) => item.ranges),
          text: chain.map((item) => item.text).join(''),
        },
        chain.flatMap(revisionSiteNodeIdsOf)
      )
    );
    for (const item of chain.slice(1)) consumed.add(item);
  };
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.ranges[0]!.start.offset - b.ranges[0]!.start.offset);
    let chain: ReviewRevisionItem[] = [];
    for (const item of bucket) {
      if (
        chain.length &&
        chain[chain.length - 1]!.ranges[0]!.end.offset !== item.ranges[0]!.start.offset
      ) {
        close(chain);
        chain = [];
      }
      chain.push(item);
    }
    close(chain);
  }
  return items.filter((item) => !consumed.has(item)).map((item) => replacements.get(item) ?? item);
}

interface FormatRun {
  readonly item: ReviewRevisionItem;
  readonly key: string;
  readonly first: { readonly paragraphId: string; readonly offset: number };
  readonly last: { readonly paragraphId: string; readonly offset: number };
  /** Paragraphs whose mark this decision formats. */
  readonly marks: ReadonlySet<string>;
}

const unique = <T>(values: readonly T[]): T[] => [
  ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
];

/**
 * One run-formatting decision across contiguous text and paragraph marks.
 *
 * One formatting edit records a `w:rPrChange` on every run it covers and on the marks of the
 * paragraphs it spans, by one author at one date. A saved file gives each its own `@w:id`, so
 * the id cannot join them. Neighbours join when they record the same author, date, nesting and
 * formatting delta, and touch: the next one starts where the previous one ends in the same
 * paragraph, or at the start of the following paragraph after the previous one formatted that
 * paragraph's mark. Anything between them, or any other difference, keeps them apart.
 */
export function mergeContiguousRunFormatting(
  items: readonly ReviewRevisionItem[],
  part: OoxmlPart,
  sites: readonly RevisionSite[],
  order: ReadonlyMap<string, number>
): readonly ReviewRevisionItem[] {
  const siteById = new Map(sites.map((site) => [site.node.id, site]));
  const siteIndex = new Map(sites.map((site, index) => [site.node.id, index]));
  const before = (
    a: { readonly paragraphId: string; readonly offset: number },
    b: { readonly paragraphId: string; readonly offset: number }
  ): number =>
    (order.get(a.paragraphId) ?? -1) - (order.get(b.paragraphId) ?? -1) || a.offset - b.offset;
  const candidates: FormatRun[] = [];
  for (const item of items) {
    if (
      item.revisionKind !== 'format' ||
      item.formattingKind !== 'rPrChange' ||
      item.readOnly ||
      item.date === undefined ||
      item.ranges.length === 0 ||
      item.ranges.some((range) => range.start.paragraphId !== range.end.paragraphId)
    )
      continue;
    const deltas = new Set<string | undefined>();
    const marks = new Set<string>();
    for (const id of revisionSiteNodeIdsOf(item)) {
      const site = siteById.get(id);
      deltas.add(site && signature(site, true));
      if (site?.paragraphMark && site.parent) {
        const properties = parentNodeOf(part, site.parent.id);
        const paragraph = properties && parentNodeOf(part, properties.id);
        if (paragraph?.kind === 'paragraph') marks.add(paragraph.id);
      }
    }
    const [delta] = deltas;
    if (deltas.size !== 1 || delta === undefined) continue;
    let first = item.ranges[0]!.start;
    let last = item.ranges[0]!.end;
    for (const range of item.ranges) {
      if (before(range.start, first) < 0) first = range.start;
      if (before(range.end, last) > 0) last = range.end;
    }
    // NUL-separated: XML text cannot carry U+0000, so an author name cannot forge a boundary.
    const key = [item.author, item.date, item.nesting, item.ranges[0]!.partName, delta].join(
      '\u0000'
    );
    candidates.push({ item, key, first, last, marks });
  }
  if (candidates.length < 2) return items;
  candidates.sort((a, b) => before(a.first, b.first));
  const following = followingSiblingParagraphs(part);
  const touches = (previous: FormatRun, next: FormatRun): boolean =>
    (previous.last.paragraphId === next.first.paragraphId &&
      previous.last.offset === next.first.offset) ||
    (previous.marks.has(previous.last.paragraphId) &&
      following.get(previous.last.paragraphId) === next.first.paragraphId &&
      next.first.offset === 0);
  const chains: FormatRun[][] = [];
  const open = new Map<string, FormatRun[]>();
  for (const candidate of candidates) {
    const chain = open.get(candidate.key);
    const tail = chain?.[chain.length - 1];
    if (chain && tail && touches(tail, candidate)) {
      chain.push(candidate);
      continue;
    }
    const started = [candidate];
    chains.push(started);
    open.set(candidate.key, started);
  }
  const consumed = new Set<ReviewRevisionItem>();
  const replacements = new Map<ReviewRevisionItem, ReviewRevisionItem>();
  for (const chain of chains) {
    if (chain.length < 2) continue;
    // In site order, as one shared id lists them, so the decision reads the same either way.
    const firstSite = (item: ReviewRevisionItem) =>
      revisionSiteNodeIdsOf(item).reduce(
        (lowest, id) => Math.min(lowest, siteIndex.get(id) ?? Infinity),
        Infinity
      );
    const members = chain.map((run) => run.item).sort((a, b) => firstSite(a) - firstSite(b));
    const first = members[0]!;
    const formattingChanges = unique(members.flatMap((item) => item.formattingChanges ?? []));
    const formattingLanguages = unique(members.flatMap((item) => item.formattingLanguages ?? []));
    replacements.set(
      first,
      registerRevisionSiteNodeIds(
        {
          ...first,
          addresses: unique(members.flatMap((item) => item.addresses)),
          ranges: members.flatMap((item) => item.ranges),
          text: members.map((item) => item.text).join(''),
          ...(formattingChanges.length ? { formattingChanges } : {}),
          ...(formattingLanguages.length ? { formattingLanguages } : {}),
        },
        members.flatMap(revisionSiteNodeIdsOf)
      )
    );
    for (const item of members.slice(1)) consumed.add(item);
  }
  if (consumed.size === 0) return items;
  return items.filter((item) => !consumed.has(item)).map((item) => replacements.get(item) ?? item);
}
