// Comments + tracked revisions tests (document-engine task 12.4).

import { describe, expect, test } from 'bun:test';
import {
  reply,
  resolveComment,
  threadOf,
  acceptRevision,
  rejectRevision,
  pendingRevisions,
  type Comment,
  type TrackedRevision,
} from '../store/index.ts';

const range = { startBlock: 'p1', startOffset: 0, endBlock: 'p1', endOffset: 3 };
const comment = (id: string, at: number, parentId?: string): Comment => ({
  id,
  authorId: 'alice',
  at,
  text: `c${id}`,
  status: 'open',
  parentId,
  anchor: range,
});

describe('comments + threads', () => {
  test('reply attaches to a parent and threadOf orders root + replies by time', () => {
    const root = comment('1', 10);
    const r1 = reply(root, { id: '2', authorId: 'bob', at: 20, text: 'reply', anchor: range });
    const r2 = reply(root, { id: '3', authorId: 'carol', at: 15, text: 'reply2', anchor: range });
    expect(r1.parentId).toBe('1');
    expect(threadOf([r2, root, r1], '1').map((c) => c.id)).toEqual(['1', '3', '2']); // by `at`
  });
  test('resolve is idempotent', () => {
    const resolved = resolveComment(comment('1', 10));
    expect(resolved.status).toBe('resolved');
    expect(resolveComment(resolved)).toBe(resolved);
  });
});

describe('tracked revisions', () => {
  const rev = (over: Partial<TrackedRevision> = {}): TrackedRevision => ({
    id: 'r1',
    kind: 'insert',
    authorId: 'alice',
    at: 1,
    status: 'pending',
    anchor: range,
    ...over,
  });

  test('accept / reject transition a pending revision', () => {
    const a = acceptRevision(rev());
    expect(a).toMatchObject({ ok: true });
    if (a.ok) expect(a.revision.status).toBe('accepted');
    const r = rejectRevision(rev());
    if (r.ok) expect(r.revision.status).toBe('rejected');
  });

  test('a locked revision refuses accept/reject', () => {
    expect(acceptRevision(rev({ locked: true }))).toMatchObject({ ok: false, reason: 'locked' });
  });

  test('an already-resolved revision cannot be re-resolved', () => {
    expect(acceptRevision(rev({ status: 'accepted' }))).toMatchObject({ ok: false, reason: 'already-resolved' });
  });

  test('pendingRevisions filters across stories (atomic-accept candidates)', () => {
    const revs = [rev({ id: 'a' }), rev({ id: 'b', status: 'accepted' }), rev({ id: 'c', kind: 'structural' })];
    expect(pendingRevisions(revs).map((r) => r.id)).toEqual(['a', 'c']);
  });
});
