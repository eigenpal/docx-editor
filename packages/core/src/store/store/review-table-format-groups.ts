import { WML_NAMESPACE_URI, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import {
  registerRevisionSiteNodeIds,
  revisionSiteNodeIdsOf,
  type ReviewRevisionItem,
} from './review-items.ts';
import type { RevisionSite } from './tree-op-revisions.ts';

const isW = (node: OoxmlNode, name: string) =>
  node.kind !== 'textValue' && node.namespaceUri === WML_NAMESPACE_URI && node.localName === name;
interface FormatGroup {
  ids: Set<string>;
  author: string;
}

/** Word's row/cell formatting entries, kept separate from text/property-run decisions. */
export function groupTableFormatting(
  part: OoxmlPart,
  items: readonly ReviewRevisionItem[],
  sites: readonly RevisionSite[]
): ReviewRevisionItem[] {
  const supported = new Set(['tcPrChange', 'trPrChange', 'tblPrExChange', 'tblGridChange']);
  const formatting = new Map(
    sites
      .filter((site) => site.propertyChange && supported.has(site.node.localName))
      .map((site) => [site.node.id, site])
  );
  if (!formatting.size) return [...items];
  const groups: FormatGroup[] = [];
  const owner = new Map<string, FormatGroup>();
  const authorOf = (site: RevisionSite) =>
    site.node.attributes.find(
      (a) => a.namespaceUri === WML_NAMESPACE_URI && a.localName === 'author'
    )?.value ?? '';
  const collect = (node: OoxmlNode, found: RevisionSite[]): void => {
    if (node.kind === 'textValue' || isW(node, 'tbl')) return;
    const site = formatting.get(node.id);
    if (site) found.push(site);
    for (const child of node.children) collect(child, found);
  };
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (isW(node, 'tbl')) {
      let current: FormatGroup | undefined;
      const tableGroups: FormatGroup[] = [];
      const grid: RevisionSite[] = [];
      let refusedRow = false;
      for (const child of node.children) {
        if (isW(child, 'tblGrid')) collect(child, grid);
        if (!isW(child, 'tr')) continue;
        const found: RevisionSite[] = [];
        collect(child, found);
        refusedRow ||= found.some((site) => site.refused);
        if (!found.length || found.some((site) => site.refused)) {
          current = undefined;
          continue;
        }
        // Cell histories within one row are one entry even across authors.
        // Word attributes that entry to the last property history in the row.
        const author = authorOf(found[found.length - 1]!);
        if (!current || current.author !== author) {
          current = { ids: new Set(), author };
          groups.push(current);
          tableGroups.push(current);
        }
        for (const site of found) current.ids.add(site.node.id);
      }
      // The grid is shared history, not another row-formatting decision. Carry
      // its canonical identity on the last group; resolution retains the history
      // while another row decision is pending, so either decision order is safe.
      const last = tableGroups.at(-1);
      if (last && !refusedRow && grid.every((site) => !site.refused)) {
        for (const site of grid) last.ids.add(site.node.id);
      }
    }
    for (const child of node.children) visit(child);
  };
  visit(part.root);
  for (const group of groups) for (const id of group.ids) owner.set(id, group);
  const members = new Map<FormatGroup, ReviewRevisionItem[]>();
  for (const item of items) {
    const ids = revisionSiteNodeIdsOf(item);
    const group = ids.length ? owner.get(ids[0]!) : undefined;
    if (
      !group ||
      item.readOnly ||
      item.revisionKind !== 'format' ||
      !ids.every((id) => owner.get(id) === group)
    )
      continue;
    const entries = members.get(group) ?? [];
    entries.push(item);
    members.set(group, entries);
  }
  const replaced = new Map<ReviewRevisionItem, ReviewRevisionItem>();
  const consumed = new Set<ReviewRevisionItem>();
  for (const group of groups) {
    const membersOfGroup = members.get(group) ?? [];
    const primary =
      membersOfGroup.find((item) => item.formattingKind !== 'tblGridChange') ?? membersOfGroup[0];
    const entries = primary ? [primary, ...membersOfGroup.filter((item) => item !== primary)] : [];
    const ids = entries.flatMap(revisionSiteNodeIdsOf);
    const included = new Set(ids);
    if (!primary || entries.length < 2 || ![...group.ids].every((id) => included.has(id))) continue;
    const addresses = [
      ...new Map(
        entries
          .flatMap((item) => item.addresses)
          .map((address) => [
            JSON.stringify([address.id, address.author, address.date ?? null]),
            address,
          ])
      ).values(),
    ];
    const ranges = [
      ...new Map(
        entries
          .filter((item) => item.formattingKind !== 'tblGridChange')
          .flatMap((item) => item.ranges)
          .map((range) => [JSON.stringify(range), range])
      ).values(),
    ];
    replaced.set(
      primary,
      registerRevisionSiteNodeIds(
        {
          ...primary,
          author: group.author,
          addresses,
          ranges,
          text: [...new Set(entries.map((item) => item.text).filter(Boolean))].join('\n'),
        },
        ids
      )
    );
    for (const item of entries.slice(1)) consumed.add(item);
  }
  return items.filter((item) => !consumed.has(item)).map((item) => replaced.get(item) ?? item);
}
