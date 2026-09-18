import { expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import {
  reviewTableGroupingCases,
  reviewTableGroupingParts,
} from '../../store/__tests__/fixtures/review-table-grouping-cases.ts';
import { handlesAt, open, reopen, savedPartBytes } from './support/protocol.ts';
for (const action of ['acceptRevision', 'rejectRevision'] as const) {
  test(`automation ${action} preflights single-site row dependencies`, () => {
    const fixture = reviewTableGroupingCases.find(
      (c) =>
        c.name ===
        (action === 'acceptRevision' ? 'nested-following-gap-del' : 'nested-following-gap-ins')
    )!;
    const bytes = zipSync(
      Object.fromEntries(
        Object.entries(reviewTableGroupingParts(fixture)).map(([name, xml]) => [name, strToU8(xml)])
      )
    );
    let refused = 0;
    for (let index = 0; index < 4; index++) {
      const current = reopen(open(bytes));
      const before = savedPartBytes(current.host, 'word/document.xml');
      const revisions = handlesAt(
        current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
        0
      );
      expect(revisions).toHaveLength(4);
      const result = current.host.execute({
        operations: [{ op: action, revision: revisions[index]! }],
      });
      if (!result.ok) {
        refused++;
        expect(savedPartBytes(current.host, 'word/document.xml')).toEqual(before);
      }
    }
    // Three independent text edits resolve; the row requires its contained edits.
    expect(refused).toBe(1);
  });
  test(`automation ${action} resolves mixed table formatting`, () => {
    const fixture = reviewTableGroupingCases.find((c) => c.name === 'format-row-and-cells')!;
    const current = reopen(
      open(
        zipSync(
          Object.fromEntries(
            Object.entries(reviewTableGroupingParts(fixture)).map(([name, xml]) => [
              name,
              strToU8(xml),
            ])
          )
        )
      )
    );
    const revisions = handlesAt(
      current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
      0
    );
    expect(revisions).toHaveLength(1);
    expect(
      current.host.execute({ operations: [{ op: action, revision: revisions[0]! }] })
    ).toMatchObject({ ok: true });
    const after = reopen(current.host);
    expect(
      handlesAt(after.host.execute({ operations: [{ op: 'getRevisions', body: after.body }] }), 0)
    ).toHaveLength(0);
    expect(savedPartBytes(after.host, 'word/document.xml').includes('FFFF00')).toBe(
      action === 'acceptRevision'
    );
    expect(savedPartBytes(after.host, 'word/document.xml').includes('<w:trHeight')).toBe(
      action === 'acceptRevision'
    );
  });
  test(`automation ${action} resolves a whole table group`, () => {
    const fixture = reviewTableGroupingCases.find((c) => c.name === 'paragraph-marks-ins')!;
    const host = open(
      zipSync(
        Object.fromEntries(
          Object.entries(reviewTableGroupingParts(fixture)).map(([name, xml]) => [
            name,
            strToU8(xml),
          ])
        )
      )
    );
    const current = reopen(host);
    const revisions = handlesAt(
      current.host.execute({ operations: [{ op: 'getRevisions', body: current.body }] }),
      0
    );
    expect(revisions).toHaveLength(1);
    const result = current.host.execute({ operations: [{ op: action, revision: revisions[0]! }] });
    expect(result).toMatchObject({ ok: true });
    const after = reopen(current.host);
    expect(
      handlesAt(after.host.execute({ operations: [{ op: 'getRevisions', body: after.body }] }), 0)
    ).toHaveLength(0);
    expect(savedPartBytes(after.host, 'word/document.xml').includes('First A')).toBe(
      action === 'acceptRevision'
    );
  });
}
