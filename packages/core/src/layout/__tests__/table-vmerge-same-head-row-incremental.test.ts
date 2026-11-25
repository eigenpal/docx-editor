// Incremental relayout of a shorter vertical merge beside a longer one (`w:vMerge`, `CT_VMerge`,
// ECMA-376 Part 1, 17.4.84) over `hRule="exact"` rows (`w:trHeight`, `CT_Height`, 17.4.80). The
// shorter merge joins the plan of the longer one, so pushing the table across a page break and
// editing inside the shorter head must lay out the same as a fresh layout.

import { expect, test } from 'bun:test';
import { applyTreeOp } from '../../store/store/tree-ops.ts';
import { createLayoutSession } from '../layout-session.ts';
import { createParagraphLayoutCache } from '../layout-cache.ts';
import { cell, lay, load, para } from './table-row-keep-fixtures.ts';
import type { OoxmlNode, OoxmlPart, TreeDocOp } from '../../store/index.ts';

// 170pt body, 14pt lines. Rows are exact 6pt, 28pt and 28pt. Column 0 merges rows 0-1 and
// column 2 merges rows 0-2; the shorter head holds five lines, more than its rows can show.
const exactRow = (twips: number) =>
  `<w:trPr><w:trHeight w:val="${twips}" w:hRule="exact"/></w:trPr>`;
const RESTART = '<w:vMerge w:val="restart"/>';
const CONTINUE = '<w:vMerge/>';
const shortHead = Array.from({ length: 5 }, (_, i) => para(`H${i}`)).join('');
const tableXml =
  '<w:tbl><w:tblPr><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr>${exactRow(120)}${cell(shortHead, RESTART)}${cell(para('M0'))}${cell(para('L'), RESTART)}</w:tr>` +
  `<w:tr>${exactRow(560)}${cell('<w:p/>', CONTINUE)}${cell(para('M1'))}${cell('<w:p/>', CONTINUE)}</w:tr>` +
  `<w:tr>${exactRow(560)}${cell(para('K2'))}${cell(para('M2'))}${cell('<w:p/>', CONTINUE)}</w:tr>` +
  '</w:tbl>';

const body = (part: OoxmlPart) => part.root.children.find((n) => n.kind === 'body')!;
const apply = (part: OoxmlPart, op: TreeDocOp) => {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
};
const firstParagraphIn = (node: OoxmlNode): OoxmlNode | undefined => {
  if (node.kind === 'paragraph') return node;
  for (const child of node.children ?? []) {
    const found = firstParagraphIn(child);
    if (found) return found;
  }
  return undefined;
};

test('incremental relayout of a shorter merge beside a longer one matches a fresh layout', () => {
  let part = load(para('P', 4, {}) + tableXml + para('After'));
  const session = createLayoutSession();
  const cache = createParagraphLayoutCache();
  lay(part, 15, { session, cache });
  const check = (label: string) => {
    const incremental = lay(part, 15, { session, cache });
    const fresh = lay(part);
    expect({ label, pages: JSON.stringify(incremental.pages) }).toEqual({
      label,
      pages: JSON.stringify(fresh.pages),
    });
  };
  const leading = () => body(part).children.find((n) => n.kind === 'paragraph')!.id;
  const headParagraph = () =>
    firstParagraphIn(body(part).children.find((n) => n.kind === 'table')!)!.id;
  // Push the table down one line at a time, across the page break.
  for (let i = 0; i < 9; i++) {
    part = apply(part, { op: 'insertText', paragraphId: leading(), offset: 0, text: 'Q' });
    part = apply(part, { op: 'splitParagraph', paragraphId: leading(), offset: 1 });
    check(`push ${i}`);
  }
  // Edit inside the shorter head.
  for (let i = 0; i < 3; i++) {
    part = apply(part, { op: 'deleteBlock', blockId: headParagraph() });
    check(`shrink ${i}`);
  }
  for (let i = 0; i < 3; i++) {
    part = apply(part, { op: 'splitParagraph', paragraphId: headParagraph(), offset: 0 });
    check(`grow ${i}`);
  }
  // Pull the table back up.
  for (let i = 0; i < 9; i++) {
    part = apply(part, { op: 'deleteBlock', blockId: leading() });
    check(`pull ${i}`);
  }
});
