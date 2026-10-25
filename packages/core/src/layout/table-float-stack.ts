// Adjacent floating tables that share one position stack into one table.
//
// Two `w:tbl` elements with no paragraph between them and identical `w:tblpPr` attributes form
// one floating table: the later one starts at the bottom of the earlier one, with no gap and
// without its own offset. Tables whose positions differ, or that have a paragraph between them,
// keep their own placement and may overlap.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { BlockFragmentRecord, TableFragmentRecord } from './semantic-records.ts';
import type { PositionedTableAnchor } from './table-float-position.ts';

function tblpPr(table: OoxmlElement): OoxmlElement | undefined {
  for (const child of table.children) {
    if (child.kind === 'textValue' || child.localName !== 'tblPr') continue;
    for (const property of child.children)
      if (property.kind !== 'textValue' && property.localName === 'tblpPr') return property;
  }
  return undefined;
}

function sameAttributes(a: OoxmlElement, b: OoxmlElement): boolean {
  if (a.attributes.length !== b.attributes.length) return false;
  return a.attributes.every((attribute) =>
    b.attributes.some(
      (other) =>
        other.localName === attribute.localName &&
        other.namespaceUri === attribute.namespaceUri &&
        other.value === attribute.value
    )
  );
}

/** The table `table` stacks below: the floating table right before it with the same position. */
export function stackPartner(
  positioned: readonly PositionedTableAnchor[],
  table: PositionedTableAnchor
): PositionedTableAnchor | undefined {
  const previous = positioned.find((candidate) => candidate.sourceIndex === table.sourceIndex - 1);
  if (!previous || previous.anchorId !== table.anchorId) return undefined;
  const own = tblpPr(table.table);
  const theirs = tblpPr(previous.table);
  return own && theirs && sameAttributes(own, theirs) ? previous : undefined;
}

/** The last fragment of `tableId` among `fragments`, when that table is on the page. */
export function lastTableFragment(
  fragments: readonly BlockFragmentRecord[],
  tableId: string
): TableFragmentRecord | undefined {
  for (let index = fragments.length - 1; index >= 0; index--) {
    const fragment = fragments[index]!;
    if (fragment.kind === 'table' && fragment.tableId === tableId) return fragment;
  }
  return undefined;
}

/**
 * The anchor top that puts `table` right below its stack partner's fragment on this page, or
 * `undefined` when it does not stack or the partner is not on the page.
 */
export function stackedAnchorY(
  positioned: readonly PositionedTableAnchor[],
  table: PositionedTableAnchor,
  fragments: readonly BlockFragmentRecord[]
): number | undefined {
  const partner = stackPartner(positioned, table);
  const below = partner && lastTableFragment(fragments, partner.table.id);
  return below ? below.box.y + below.box.height - table.float.yPt : undefined;
}
