/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { expect, mock, test } from 'bun:test';
import type { CanonicalPrimitiveEffect } from '@docx-editor.dev/core/collaboration/replication';
import { asLogicalId } from '../document/identity.ts';
import type { MaterializeResult } from '../document/materialize.ts';
import { prepareMemberRootJournal } from '../document/prepare-member-root-journal.ts';
import { loadPackage } from './document-support.ts';
import { zipDocument } from './document-peer-support.ts';

const member = '/word/numbering.xml#0';
const success: MaterializeResult = {
  ok: true,
  package: loadPackage(zipDocument('<w:p/>')),
  issues: [],
};
const splice = (parentLogicalId: string): CanonicalPrimitiveEffect => ({
  kind: 'spliceChildren',
  parentLogicalId,
  start: 0,
  deleteCount: 0,
  childLogicalIds: ['new'],
});
const ready = () => false;
function fixture(result: MaterializeResult = success) {
  return {
    current: mock(() => result),
    shownPartChildren: mock((id: string) => (id === member ? [asLogicalId('existing')] : null)),
  };
}

test('typing, no-op journals, and paragraph edits do not materialize the package', () => {
  const view = fixture();
  for (const effects of [
    [],
    [{ kind: 'spliceText', logicalId: 'text', utf16Start: 0, deleteCount: 0, insert: 'x' }],
    [splice('paragraph')],
    [
      {
        kind: 'moveNode',
        logicalId: 'run',
        destinationParentLogicalId: 'paragraph',
        destinationIndex: 0,
      },
    ],
  ] as readonly CanonicalPrimitiveEffect[][]) {
    expect(prepareMemberRootJournal(view, { effects }, ready)).toBeNull();
  }
  expect(view.current).not.toHaveBeenCalled();
});

test('several member splices refresh once before their coordinate projection', () => {
  const view = fixture();
  expect(
    prepareMemberRootJournal(
      view,
      { effects: [splice('paragraph'), splice(member), splice(member)] },
      ready
    )
  ).toBeNull();
  expect(view.current).toHaveBeenCalledTimes(1);
});

test('a move into a member root refreshes its coordinates', () => {
  const view = fixture();
  expect(
    prepareMemberRootJournal(
      view,
      {
        effects: [
          {
            kind: 'moveNode',
            logicalId: 'definition',
            destinationParentLogicalId: member,
            destinationIndex: 0,
          },
        ],
      },
      ready
    )
  ).toBeNull();
  expect(view.current).toHaveBeenCalledTimes(1);
});

test.each(['missing-root', 'missing-blob', 'invalid-relationships'] as const)(
  'a failed member refresh preserves the typed %s refusal',
  (code) => {
    const view = fixture({ ok: false, code, issues: [] });
    expect(prepareMemberRootJournal(view, { effects: [splice(member)] }, ready)).toEqual({
      failure: { code },
      transient: false,
    });
    expect(view.current).toHaveBeenCalledTimes(1);
  }
);

test('a member refresh refuses dropped content and reports its reason', () => {
  const view = fixture({ ...success, issues: [{ code: 'missing-node' }] });
  expect(prepareMemberRootJournal(view, { effects: [splice(member)] }, ready)).toEqual({
    failure: { code: 'materialize-dropped-content', detail: 'missing-node=1' },
    transient: false,
  });
});

test('a harmless repaired duplicate does not refuse member edits', () => {
  const view = fixture({ ...success, issues: [{ code: 'duplicate-child' }] });
  expect(prepareMemberRootJournal(view, { effects: [splice(member)] }, ready)).toBeNull();
});

test('a refusal while a held-back update waits is transient', () => {
  const waiting = mock(() => true);
  for (const result of [
    { ok: false, code: 'missing-root', issues: [] },
    { ...success, issues: [{ code: 'missing-node' }] },
  ] as MaterializeResult[]) {
    const refusal = prepareMemberRootJournal(
      fixture(result),
      { effects: [splice(member)] },
      waiting
    );
    expect(refusal?.transient).toBe(true);
  }
});

test('a successful refresh does not ask whether updates wait', () => {
  const waiting = mock(() => true);
  expect(prepareMemberRootJournal(fixture(), { effects: [splice(member)] }, waiting)).toBeNull();
  expect(waiting).not.toHaveBeenCalled();
});
