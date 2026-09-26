// Keep chains that cross table rows (§17.3.1.15, §17.3.1.23).
//
// A table whose first row starts a new page ends a keep chain: the caption before it needs no
// room for it. A row that starts a new page ends the kept group above it. Before Word 2013 the
// group stays on its page; from Word 2013 on it goes to the new page with that row.
//
// A `w:keepNext` paragraph before a table whose body rows all keep goes on through those rows
// to the content after the table, so it moves with them. Before Word 2013, header rows do not
// keep with the body rows: the caption keeps with the header rows only, and a kept body group
// below them moves on its own under the repeated header.
//
// A kept last row prices a following keep chain for the room the row leaves, and a retained
// layout re-places the table and the caption when any block that pricing reads changes.
//
// The page shapes come from captured probes in compatibility modes 14 and 15, except where a
// case says it is inferred.

import { describe, expect, test } from 'bun:test';
import { TreeDocumentStore, type OoxmlPart } from '@docx-editor.dev/core/store';
import { layoutSemanticDocument } from '../semantic-layout.ts';
import { createLayoutSession } from '../layout-session.ts';
import { keepNextFlowKeys } from '../pagination-keeps.ts';
import {
  ALL,
  lay,
  load,
  measurer,
  P8,
  pages,
  para,
  row,
  styleCascade,
  table,
  TAIL,
} from './table-row-keep-fixtures.ts';

const P = 'P1 P2 P3 P4 P5 P6 P7 P8';
const CAP = para('CAP', 1, { keep: true });
const breaking = (name: string, lines = 1, keep = false) =>
  para(name, lines, { keep, pageBreakBefore: true });
/** A kept caption with 10pt of space after it. */
const CAP_AFTER =
  '<w:p><w:pPr><w:keepNext/><w:widowControl w:val="0"/>' +
  '<w:spacing w:before="0" w:after="200" w:line="280" w:lineRule="exact"/></w:pPr>' +
  '<w:r><w:t>CAP1</w:t></w:r></w:p>';
const mergedHeader = [
  row('HA', { header: true, firstTcPr: '<w:vMerge w:val="restart"/>' }),
  row('HB', { header: true, first: para('', 1), firstTcPr: '<w:vMerge/>' }),
];

/** A case name, the compatibility modes it holds in, the body, and the pages. */
type Case = readonly [string, readonly number[], string, readonly string[]];
const run = (cases: readonly Case[]) => {
  for (const [name, modes, body, expected] of cases) {
    for (const mode of modes) {
      test(`mode ${mode}: ${name}`, () => {
        expect(pages(lay(load(body), mode))).toEqual([...expected]);
      });
    }
  }
};

const keptFirstThenBreak =
  para('P', 11) +
  CAP +
  table([row('R1', { keep: ALL }), row('R2', { first: breaking('R2c1-') })]) +
  TAIL;

const breakingSuccessor =
  P8 +
  table([
    row('R1'),
    row('R2'),
    row('R3', { keep: ALL }),
    row('R4', { cantSplit: true, first: breaking('R4c1-', 2) }),
  ]) +
  TAIL;

describe('a row or table that starts a new page ends the keep before it', () => {
  run([
    [
      'a kept row stays when the next row starts a new page',
      [14],
      breakingSuccessor,
      [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1`, 'R4c1-1 R4c1-2 R4c2-1 TAIL1'],
    ],
    [
      'a kept row goes to the new page that the next row starts',
      [15],
      breakingSuccessor,
      [`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1`, 'R3c1-1 R3c2-1 R4c1-1 R4c1-2 R4c2-1 TAIL1'],
    ],
    [
      'a kept row goes to the new page that a kept row after it starts',
      [15],
      P8 +
        table([
          row('R1'),
          row('R2', { keep: ALL }),
          row('R3', { keep: ALL, first: breaking('R3c1-', 1, true) }),
          row('R4', { lines: 2, cantSplit: true }),
        ]) +
        TAIL,
      [`${P} R1c1-1 R1c2-1`, 'R2c1-1 R2c2-1 R3c1-1 R3c2-1 R4c1-1 R4c1-2 R4c2-1 TAIL1'],
    ],
    [
      'a caption stays when the table starts a new page',
      [14, 15],
      para('P', 11) +
        CAP_AFTER +
        table([row('R1', { first: breaking('R1c1-') }), row('R2')]) +
        TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11 CAP1', 'R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'a caption stays when the header row starts a new page',
      [14, 15],
      para('P', 11) +
        CAP +
        table([row('H', { header: true, first: breaking('Hc1-') }), row('R1'), row('R2')]) +
        TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11 CAP1', 'Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'a caption goes with kept first rows to the page the next row starts',
      [15],
      keptFirstThenBreak,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11', 'CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    // Inferred from the shape above: the chain start takes the page break, not the fit.
    [
      'a caption that fits beside kept first rows still goes with them to the new page',
      [15],
      keptFirstThenBreak.replace(para('P', 11), para('P', 10)),
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10', 'CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'a caption moves with a kept first row, and the next row starts a new page',
      [14],
      keptFirstThenBreak,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 P11', 'CAP1 R1c1-1 R1c2-1', 'R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'a kept last row stays when the paragraph after the table starts a new page',
      [14, 15],
      para('P', 10) +
        table([row('R1'), row('R2', { keep: ALL })]) +
        para('Q', 2, { pageBreakBefore: true }) +
        TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 R1c1-1 R1c2-1 R2c1-1 R2c2-1', 'Q1 Q2 TAIL1'],
    ],
  ]);
});

const keptHeaderBody =
  P8 +
  CAP +
  table([row('H', { header: true }), row('R1', { keep: ALL }), row('R2', { keep: ALL })]) +
  TAIL;
const mergedHeaderBody = [...mergedHeader, row('B1', { lines: 3 }), row('B2')];
const MERGED_BODY = 'B1c1-1 B1c1-2 B1c1-3 B1c2-1 B2c1-1 B2c2-1 TAIL1';

describe('a caption keeps through a table whose body rows all keep', () => {
  run([
    [
      'the caption moves with the kept rows and the paragraph after them',
      [14, 15],
      P8 +
        CAP +
        table([row('R1', { keep: ALL }), row('R2', { keep: ALL }), row('R3', { keep: ALL })]) +
        TAIL,
      [P, 'CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 R3c1-1 R3c2-1 TAIL1'],
    ],
    [
      'the caption moves with a kept row and a keepLines paragraph after it',
      [14, 15],
      para('P', 10) + CAP + table([row('R1', { keep: ALL })]) + para('Q', 2, { keepLines: true }),
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9 P10', 'CAP1 R1c1-1 R1c2-1 Q1 Q2'],
    ],
    [
      'the caption moves with the header rows and the kept body rows',
      [15],
      keptHeaderBody,
      [P, 'CAP1 Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'the caption stays with the header rows, and the kept body rows move below a repeat',
      [14],
      keptHeaderBody,
      [`${P} CAP1 Hc1-1 Hc2-1`, 'Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
    [
      'the caption stays with the header rows, and a kept first row moves below a repeat',
      [14],
      P8 +
        CAP +
        table([
          row('H', { header: true }),
          row('R1', { keep: ALL }),
          row('R2', { lines: 3, cantSplit: true }),
        ]) +
        TAIL,
      [`${P} CAP1 Hc1-1 Hc2-1`, 'Hc1-1 Hc2-1 R1c1-1 R1c2-1 R2c1-1 R2c1-2 R2c1-3 R2c2-1 TAIL1'],
    ],
    [
      'the caption moves with header rows that a vertical merge crosses',
      [15],
      para('P', 9) + CAP + table(mergedHeaderBody) + TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 P8 P9', `CAP1 HAc1-1 HAc2-1 HBc2-1 ${MERGED_BODY}`],
    ],
    [
      'the caption stays with header rows that a vertical merge crosses',
      [14],
      para('P', 9) + CAP + table(mergedHeaderBody) + TAIL,
      [
        'P1 P2 P3 P4 P5 P6 P7 P8 P9 CAP1 HAc1-1 HAc2-1 HBc2-1',
        `HAc1-1 HAc2-1 HBc2-1 ${MERGED_BODY}`,
      ],
    ],
    [
      'header rows at a page top stay when the kept body group below them moves',
      [14],
      table([
        row('H', { header: true }),
        ...[1, 2, 3, 4].map((i) => row(`K${i}`, { lines: 3, keep: ALL })),
        row('R5', { lines: 2, cantSplit: true }),
      ]) + TAIL,
      [
        'Hc1-1 Hc2-1',
        'Hc1-1 Hc2-1 K1c1-1 K1c1-2 K1c1-3 K1c2-1 K2c1-1 K2c1-2 K2c1-3 K2c2-1 ' +
          'K3c1-1 K3c1-2 K3c1-3 K3c2-1 K4c1-1 K4c1-2 K4c2-1',
        'Hc1-1 Hc2-1 K4c1-3 R5c1-1 R5c1-2 R5c2-1 TAIL1',
      ],
    ],
    [
      'header rows that a vertical merge crosses stay and repeat',
      [14],
      para('P', 10) + table(mergedHeaderBody) + TAIL,
      [
        'P1 P2 P3 P4 P5 P6 P7 P8 P9 P10 HAc1-1 HAc2-1 HBc2-1',
        `HAc1-1 HAc2-1 HBc2-1 ${MERGED_BODY}`,
      ],
    ],
    [
      'the caption moves through the first table and keeps with the second one',
      [14, 15],
      P8 +
        CAP +
        table([row('R1', { keep: ALL }), row('R2', { keep: ALL })]) +
        para('CAPB', 1, { keep: true }) +
        table([row('S1'), row('S2')]) +
        TAIL,
      [P, 'CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 CAPB1 S1c1-1 S1c2-1 S2c1-1 S2c2-1 TAIL1'],
    ],
    [
      'the caption stays when the rows it keeps with fit, and the table ends the chain',
      [14, 15],
      para('P', 7) + CAP + table([row('R1', { keep: ALL }), row('R2', { keep: ALL })]) + TAIL,
      ['P1 P2 P3 P4 P5 P6 P7 CAP1 R1c1-1 R1c2-1 R2c1-1 R2c2-1 TAIL1'],
    ],
  ]);
});

describe('a kept last row prices a following keep chain for the room it leaves', () => {
  for (const mode of [14, 15]) {
    test(`mode ${mode}: a keepNext paragraph that may split opens beside the row`, () => {
      const body =
        P8 +
        table([row('R1'), row('R2', { keep: ALL })]) +
        para('Q', 6, { keep: true, widow: true }) +
        TAIL;
      expect(pages(lay(load(body), mode))).toEqual([
        `${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 Q1 Q2`,
        'Q3 Q4 Q5 Q6 TAIL1',
      ]);
    });

    test(`mode ${mode}: a keepNext paragraph taller than a page opens beside the row`, () => {
      const body =
        P8 +
        table([row('R1'), row('R2', { keep: ALL })]) +
        para('Q', 14, { keep: true, widow: true }) +
        TAIL;
      const placed = pages(lay(load(body), mode));
      expect(placed[0]).toBe(`${P} R1c1-1 R1c2-1 R2c1-1 R2c2-1 Q1 Q2`);
      expect(placed).toHaveLength(3);
    });
  }
});

describe('retained layout re-places what a table keep reads', () => {
  const bodyOf = (part: OoxmlPart) => {
    const body = part.root.children.find((child) => child.kind === 'body');
    if (body?.kind !== 'body') throw new Error('The fixture has no body.');
    return body;
  };
  const paragraphId = (part: OoxmlPart, text: string) => {
    const found = bodyOf(part).children.find(
      (child) => child.kind === 'paragraph' && JSON.stringify(child).includes(text)
    );
    if (!found) throw new Error(`The fixture has no ${text}.`);
    return found.id;
  };
  const GROWTH = 'word '.repeat(80);
  /** Seven kept one-line members after the table, then the eighth block `K7`. */
  const chain = (grown: boolean) =>
    Array.from({ length: 7 }, (_, i) => para(`K${i}_`, 1, { keep: true, keepLines: true })).join(
      ''
    ) +
    (grown
      ? `<w:p><w:pPr><w:keepLines/><w:widowControl w:val="0"/></w:pPr><w:r><w:t xml:space="preserve">${GROWTH}K7_1</w:t></w:r></w:p>`
      : para('K7_', 1, { keepLines: true }));

  /** Lay `before` out over a retained session, edit K7 to `after`, and compare with cold. */
  const edit = (head: string, grow: boolean, mode: number) => {
    const store = new TreeDocumentStore(load(head + chain(!grow) + TAIL));
    const session = createLayoutSession();
    const first = pages(lay(store.part, mode, { session }));
    const id = paragraphId(store.part, 'K7_1');
    const result = store.transact((tx) => {
      tx.apply(
        grow
          ? { op: 'insertText', paragraphId: id, offset: 0, text: GROWTH }
          : { op: 'deleteText', paragraphId: id, start: 0, end: GROWTH.length }
      );
    });
    expect(result.ok).toBe(true);
    const retained = pages(
      layoutSemanticDocument(store.part, 2, {
        measurer,
        styleCascade,
        compatibilityMode: mode,
        session,
      })
    );
    const cold = pages(lay(structuredClone(store.part), mode));
    expect(retained).toEqual(cold);
    return { first, cold };
  };

  for (const mode of [14, 15]) {
    for (const grow of [true, false]) {
      const verb = grow ? 'growing' : 'shrinking';
      test(`mode ${mode}: ${verb} the eighth block after a kept last row`, () => {
        let moved = 0;
        for (let filler = 1; filler <= 10; filler += 1) {
          const head = para('P', filler) + table([row('ROW', { keep: ALL })]);
          const { first, cold } = edit(head, grow, mode);
          const rowPage = (placed: string[]) => placed.findIndex((page) => page.includes('ROW'));
          if (rowPage(first) !== rowPage(cold)) moved += 1;
        }
        expect(moved).toBeGreaterThan(0);
      });

      test(`mode ${mode}: ${verb} a block that a caption reads through a kept table`, () => {
        let moved = 0;
        for (let filler = 1; filler <= 10; filler += 1) {
          const head = para('P', filler) + CAP + table([row('ROW', { keep: ALL })]);
          const { first, cold } = edit(head, grow, mode);
          const capPage = (placed: string[]) => placed.findIndex((page) => page.includes('CAP1'));
          if (capPage(first) !== capPage(cold)) moved += 1;
        }
        expect(moved).toBeGreaterThan(0);
      });
    }
  }
});

describe('keep-next flow keys around tables', () => {
  const keys = Array.from({ length: 20 }, (_, i) => `b${i}`);
  /** The raw keys folded into block `index`'s key, in order: each is `length:key`. */
  const reads = (flow: readonly string[], index: number): string[] => {
    const window = flow[index]!.slice(`b${index}~kn~`.length);
    const read: string[] = [];
    for (let at = 0; at < window.length; ) {
      const length = /^\d+/.exec(window.slice(at))?.[0];
      if (length === undefined) {
        at += 1;
        continue;
      }
      const start = at + length.length + 1;
      read.push(window.slice(start, start + Number(length)));
      at = start + Number(length);
    }
    return read;
  };

  test('a table whose last row keeps reads eight blocks after it', () => {
    const tables = new Set([2]);
    const flow = keepNextFlowKeys(
      keys,
      () => true,
      undefined,
      (at) => tables.has(at)
    );
    expect(reads(flow, 2)).toEqual(['b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10']);
  });

  test('a caption reads through a kept table to what the table reads', () => {
    const tables = new Set([3]);
    const flow = keepNextFlowKeys(
      keys,
      () => true,
      undefined,
      (at) => tables.has(at)
    );
    expect(reads(flow, 2)).toEqual(['b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11']);
  });

  test('a chain stops at a table that does not keep, and reads through one table only', () => {
    const tables = new Set([3, 6]);
    const plain = keepNextFlowKeys(
      keys,
      (at) => at !== 3,
      undefined,
      (at) => tables.has(at)
    );
    expect(reads(plain, 2)).toEqual(['b3']);
    const kept = keepNextFlowKeys(
      keys,
      () => true,
      undefined,
      (at) => tables.has(at)
    );
    expect(reads(kept, 2)).toEqual(['b3', 'b4', 'b5', 'b6']);
  });
});
