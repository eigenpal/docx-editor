import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
  type OoxmlPart,
} from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  reviewItemPositionRank,
  revisionSiteNodeIdsOf,
  type ReviewRange,
  type ReviewRevisionItem,
} from './review-items.ts';
import type { SiteLocation } from './review-site-locations.ts';
import type { RevisionSite } from './tree-op-revisions.ts';
import { textUnder } from './review-text.ts';
import { groupTableFormatting } from './review-table-format-groups.ts';
import { groupAdjacentRunFormatting } from './review-run-format-groups.ts';

type Direction = 'ins' | 'del';
interface RowGroup {
  markerIds: Set<string>;
  rows: OoxmlElement[];
  author: string;
  direction: Direction;
  followingText: string[];
  rowEndOnly?: boolean;
}
const isW = (node: OoxmlNode, name: string): boolean =>
  node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
const attribute = (node: OoxmlElement, name: string) =>
  node.attributes.find((a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === name)?.value;

// Word-created nested rows include tracked cell paragraph marks. Those marks
// distinguish a complete row decision from a standalone nested row-end marker.
function hasTrackedCellParagraphs(
  row: OoxmlElement,
  direction: Direction,
  author: string
): boolean {
  const cells = row.children.filter((child) => isW(child, 'tc'));
  return (
    cells.length > 0 &&
    cells.every((cell) => {
      if (cell.kind === 'textValue') return false;
      const paragraphs = cell.children.filter((child) => child.kind === 'paragraph');
      return (
        paragraphs.length > 0 &&
        paragraphs.every((paragraph) => {
          if (paragraph.kind === 'textValue') return false;
          const properties = paragraph.children.find((child) => isW(child, 'pPr'));
          const runProperties =
            properties?.kind !== 'textValue'
              ? properties?.children.find((child) => isW(child, 'rPr'))
              : undefined;
          const marks =
            runProperties?.kind !== 'textValue'
              ? runProperties?.children.filter((child) => isW(child, 'ins') || isW(child, 'del'))
              : undefined;
          const mark = marks?.length === 1 ? marks[0] : undefined;
          return (
            !!mark &&
            mark.kind !== 'textValue' &&
            mark.localName === direction &&
            attribute(mark, 'author') === author
          );
        })
      );
    })
  );
}

/**
 * Word presents consecutive tracked rows by one author as a single table fragment.
 * Their same-direction text and paragraph marks belong to that decision even when
 * their revision IDs, timestamps, or authors differ. Cell/property revisions and
 * opposite-direction content remain independent decisions.
 *
 * Run BEFORE inline replacement pairing: a deletion inside an inserted row must
 * not take that row's inserted text away from the structural decision.
 */
function groupRowRevisions(
  part: OoxmlPart,
  items: readonly ReviewRevisionItem[],
  sites: readonly RevisionSite[],
  locations: ReadonlyMap<string, SiteLocation>
): ReviewRevisionItem[] {
  const rowSites = new Map(
    sites
      .filter(
        (s) =>
          s.parent?.localName === 'trPr' &&
          (s.node.localName === 'ins' || s.node.localName === 'del')
      )
      .map((s) => [s.node.id, s])
  );
  if (rowSites.size === 0) return [...items];
  const sitesById = new Map(sites.map((site) => [site.node.id, site]));
  const paragraphLengths = new Map<string, number>();
  for (const location of locations.values()) {
    paragraphLengths.set(
      location.paragraphId,
      Math.max(paragraphLengths.get(location.paragraphId) ?? 0, location.end)
    );
  }
  const groups: RowGroup[] = [];
  const nestedRows = new Map<string, OoxmlElement>();
  const completeNestedRows = new Set<string>();
  const ownerBySite = new Map<string, RowGroup>();
  const collect = (node: OoxmlNode, group: RowGroup): void => {
    if (node.kind === 'textValue' || isW(node, 'tbl')) return;
    const site = sitesById.get(node.id);
    const rowMarker = rowSites.has(node.id);
    if (
      site &&
      !site.propertyChange &&
      node.localName === group.direction &&
      !site.refused &&
      (rowMarker
        ? attribute(node, 'author') === group.author
        : site.paragraphMark || node.kind === 'revisionInsert' || node.kind === 'revisionDelete')
    ) {
      ownerBySite.set(node.id, group);
      if (rowMarker) group.markerIds.add(node.id);
    }
    for (const child of node.children) collect(child, group);
  };
  const walk = (node: OoxmlNode, tableDepth = 0): void => {
    if (node.kind === 'textValue') return;
    if (isW(node, 'tr') && tableDepth > 1) {
      const properties = node.children.find((child) => isW(child, 'trPr'));
      if (properties && properties.kind !== 'textValue') {
        for (const marker of properties.children) {
          if (rowSites.has(marker.id)) nestedRows.set(marker.id, node);
        }
      }
    }
    if (isW(node, 'tbl')) {
      let current: RowGroup | undefined;
      for (const child of node.children) {
        if (child.kind === 'textValue' || !isW(child, 'tr')) {
          current = undefined;
          continue;
        }
        const properties = child.children.find((n) => isW(n, 'trPr'));
        const markers =
          properties?.kind !== 'textValue'
            ? (properties?.children.filter((n) => rowSites.has(n.id)) ?? [])
            : [];
        const marker = markers.length === 1 ? markers[0] : undefined;
        const author =
          marker && marker.kind !== 'textValue' ? attribute(marker, 'author') : undefined;
        if (
          !marker ||
          marker.kind === 'textValue' ||
          author === undefined ||
          rowSites.get(marker.id)?.refused
        ) {
          current = undefined;
          continue;
        }
        const direction = marker.localName as Direction;
        if (tableDepth > 0) {
          if (!hasTrackedCellParagraphs(child, direction, author)) {
            current = undefined;
            continue;
          }
          completeNestedRows.add(child.id);
        }
        if (!current || current.author !== author || current.direction !== direction) {
          current = { markerIds: new Set(), rows: [], author, direction, followingText: [] };
          groups.push(current);
        }
        current.rows.push(child);
        current.markerIds.add(marker.id);
        collect(child, current);
      }
    }
    for (const child of node.children) walk(child, tableDepth + (isW(node, 'tbl') ? 1 : 0));
  };
  walk(part.root);
  // Nested markers appear at the row end in Word's review flow. They join
  // following same-author text before the enclosing cell ends, rather than
  // unconditionally joining the outer row. An unchanged row breaks the chain.
  let pending: { marker: OoxmlElement; row: OoxmlElement } | undefined;
  const trackedOuterRows = new Set(groups.flatMap((group) => group.rows.map((row) => row.id)));
  const nestedFlow = (node: OoxmlNode, tableDepth = 0, inTrackedOuterRow = false): void => {
    if (node.kind === 'textValue') return;
    if (completeNestedRows.has(node.id)) pending = undefined;
    const depth = tableDepth + (isW(node, 'tbl') ? 1 : 0);
    // A row-end marker cannot jump over unchanged content to claim a later edit.
    // Tracked wrappers consume pending before their runs are visited below.
    const trackedOuterRow = inTrackedOuterRow || trackedOuterRows.has(node.id);
    if (node.kind === 'run' && !trackedOuterRow) pending = undefined;
    if (pending && (node.kind === 'revisionInsert' || node.kind === 'revisionDelete')) {
      const previous = pending;
      pending = undefined;
      const site = sitesById.get(node.id);
      const author = attribute(previous.marker, 'author');
      if (
        site &&
        !site.refused &&
        author !== undefined &&
        node.localName === previous.marker.localName &&
        attribute(node, 'author') === author &&
        (ownerBySite.get(node.id)?.author ?? author) === author
      ) {
        let group = ownerBySite.get(node.id);
        if (!group) {
          group = {
            markerIds: new Set(),
            rows: [previous.row],
            author,
            direction: previous.marker.localName as Direction,
            followingText: [textUnder(node)],
            rowEndOnly: true,
          };
          groups.push(group);
          ownerBySite.set(node.id, group);
        }
        group.markerIds.add(previous.marker.id);
        ownerBySite.set(previous.marker.id, group);
      }
    }
    for (const child of node.children) nestedFlow(child, depth, trackedOuterRow);
    if (isW(node, 'tc') || (node.kind === 'paragraph' && !trackedOuterRow)) pending = undefined;
    if (isW(node, 'tr')) {
      pending = undefined;
      if (depth > 1 && !completeNestedRows.has(node.id)) {
        const properties = node.children.find((child) => isW(child, 'trPr'));
        const markers =
          properties && properties.kind !== 'textValue'
            ? properties.children.filter((child) => rowSites.has(child.id))
            : [];
        const marker = markers.length === 1 ? markers[0] : undefined;
        if (marker && marker.kind !== 'textValue' && !rowSites.get(marker.id)?.refused)
          pending = { marker, row: node };
      }
    }
  };
  nestedFlow(part.root);
  items = items.map((item) => {
    const ids = revisionSiteNodeIdsOf(item);
    if (item.revisionKind !== 'structural' || !ids.length || !ids.every((id) => nestedRows.has(id)))
      return item;
    // Nested row markers live at the row boundary. Their text is
    // context for the table preview, not content owned by the row decision.
    const ranges: ReviewRange[] = [];
    for (const id of ids) {
      let last: OoxmlElement | undefined;
      const visit = (node: OoxmlNode): void => {
        if (node.kind === 'textValue' || isW(node, 'tbl')) return;
        if (node.kind === 'paragraph') last = node;
        else for (const child of node.children) visit(child);
      };
      visit(nestedRows.get(id)!);
      if (last) {
        const position = { paragraphId: last.id, offset: paragraphLengths.get(last.id) ?? 0 };
        ranges.push({ partName: part.name, start: position, end: position });
      }
    }
    return ranges.length ? registerRevisionSiteNodeIds({ ...item, ranges }, ids) : item;
  });
  const members = new Map<RowGroup, ReviewRevisionItem[]>();
  for (const item of items) {
    const ids = revisionSiteNodeIdsOf(item);
    const group = ids.length ? ownerBySite.get(ids[0]!) : undefined;
    // One revision identity may span unrelated regions. Never silently split it.
    if (!group || item.readOnly || !ids.every((id) => ownerBySite.get(id) === group)) continue;
    const bucket = members.get(group) ?? [];
    bucket.push(item);
    members.set(group, bucket);
  }
  const consumed = new Set<ReviewRevisionItem>();
  const replacements = new Map<ReviewRevisionItem, ReviewRevisionItem>();
  for (const group of groups) {
    const entries = members.get(group) ?? [];
    const primary = entries.find((item) =>
      revisionSiteNodeIdsOf(item).some((id) => group.markerIds.has(id))
    );
    // If any row marker was not safely addressable, preserve every original card.
    const memberSites = new Set(entries.flatMap(revisionSiteNodeIdsOf));
    if (!primary || ![...group.markerIds].every((id) => memberSites.has(id))) continue;
    const ordered = [primary, ...entries.filter((item) => item !== primary)];
    const addresses = ordered.flatMap((item) => item.addresses);
    const ranges: ReviewRange[] = [];
    const preview: string[] = [];
    const addParagraphs = (node: OoxmlNode): void => {
      if (node.kind === 'textValue' || isW(node, 'tbl')) return;
      if (node.kind === 'paragraph') {
        ranges.push({
          partName: part.name,
          start: { paragraphId: node.id, offset: 0 },
          end: { paragraphId: node.id, offset: paragraphLengths.get(node.id) ?? 0 },
        });
        preview.push(textUnder(node));
        return;
      }
      for (const child of node.children) addParagraphs(child);
    };
    for (const row of group.rows) addParagraphs(row);
    if (group.rowEndOnly && ranges.length) {
      const last = ranges[ranges.length - 1]!;
      ranges.splice(0, ranges.length, { ...last, start: last.end });
    }
    const coveredParagraphs = new Set(ranges.map((range) => range.start.paragraphId));
    for (const item of ordered) {
      // The direct row paragraphs above replace the marker's broad fallback
      // range, which can otherwise include independent nested-table text.
      if (
        item.revisionKind === 'structural' &&
        revisionSiteNodeIdsOf(item).some((id) => !nestedRows.has(id))
      )
        continue;
      for (const range of item.ranges) {
        if (!coveredParagraphs.has(range.start.paragraphId)) ranges.push(range);
      }
    }
    preview.push(...group.followingText);
    const grouped = registerRevisionSiteNodeIds(
      {
        ...primary,
        addresses: [
          ...new Map(
            addresses.map((address) => [
              JSON.stringify([address.id, address.author, address.date ?? null]),
              address,
            ])
          ).values(),
        ],
        ranges: ranges.length ? ranges : ordered.flatMap((item) => item.ranges),
        text: preview.join('\n'),
        nesting: ordered.reduce((depth, item) => Math.min(depth, item.nesting), primary.nesting),
      },
      ordered.flatMap(revisionSiteNodeIdsOf)
    );
    replacements.set(primary, grouped);
    for (const item of entries) if (item !== primary) consumed.add(item);
  }
  return items.filter((item) => !consumed.has(item)).map((item) => replacements.get(item) ?? item);
}

export function groupTableRevisions(
  part: OoxmlPart,
  items: readonly ReviewRevisionItem[],
  sites: readonly RevisionSite[],
  locations: ReadonlyMap<string, SiteLocation>,
  order: ReadonlyMap<string, number>
): ReviewRevisionItem[] {
  const grouped = groupAdjacentRunFormatting(
    groupTableFormatting(part, groupRowRevisions(part, items, sites, locations), sites),
    sites
  );
  // Row markers start in property XML but nested decisions belong at row ends.
  // Preserve the existing site-order contract for paragraph-local derivations.
  const rangeIds = new Set(
    sites
      .filter(
        (site) => site.node.kind === 'moveFromRangeStart' || site.node.kind === 'moveToRangeStart'
      )
      .map((site) => site.node.id)
  );
  return rangeIds.size > 0 ||
    sites.some(
      (site) => site.parent?.localName === 'trPr' && ['ins', 'del'].includes(site.node.localName)
    )
    ? grouped.sort(
        (a, b) =>
          reviewItemPositionRank(a, order) - reviewItemPositionRank(b, order) ||
          Number(revisionSiteNodeIdsOf(b).some((id) => rangeIds.has(id))) -
            Number(revisionSiteNodeIdsOf(a).some((id) => rangeIds.has(id)))
      )
    : grouped;
}
