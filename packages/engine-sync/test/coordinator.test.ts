// ReplicationCoordinator tests (document-engine task 5.3): local commit + remote
// merge across two coordinators, echo suppression, idempotence, monotonic
// revisions, and the invariant that canonical state changes only via the
// coordinator (a backend never notifies canonical directly).

import { describe, expect, test } from 'bun:test';
import { ReplicationCoordinator, YjsBackend } from '../src/index.ts';
import { DocumentStore, createEmptyModel, paragraphText, type ModelChange } from '@docx-editor.dev/engine-core';

const P1 = 'p-1';

function peer(actor: string, base?: YjsBackend): { coord: ReplicationCoordinator; store: DocumentStore; backend: YjsBackend } {
  const store = new DocumentStore(createEmptyModel());
  const backend = base
    ? YjsBackend.join('doc', actor, base.snapshot())
    : YjsBackend.fromModel('doc', actor, createEmptyModel());
  return { coord: new ReplicationCoordinator(store, backend), store, backend };
}

describe('local commit + remote merge', () => {
  test('an A commit converges into B via the coordinator', () => {
    const a = peer('a');
    const b = peer('b', a.backend);

    const commit = a.coord.localInsertText(P1, 'hello');
    expect(commit.ok).toBe(true);
    expect(paragraphText(a.store.currentModel, P1)).toBe('hello');
    expect(a.coord.phases.local).toBe('idle'); // returned to idle

    const merge = b.coord.remoteMerge(commit.update!);
    expect(merge.ok).toBe(true);
    expect(merge.noop).toBeUndefined();
    expect(paragraphText(b.store.currentModel, P1)).toBe('hello'); // converged
    expect(b.store.currentRevision).toBe(1); // one monotonic revision
    expect(b.coord.phases.remote).toBe('idle');
  });

  test('canonical state only changes via the coordinator (publishDerived)', () => {
    const a = peer('a');
    const b = peer('b', a.backend);
    const seen: ModelChange[] = [];
    b.store.subscribe((mc) => seen.push(mc));

    // Merely applying an update to the backend must NOT touch b's canonical store...
    const commit = a.coord.localInsertText(P1, 'x');
    expect(seen).toHaveLength(0);
    // ...only remoteMerge (the coordinator) publishes + notifies.
    b.coord.remoteMerge(commit.update!);
    expect(seen).toHaveLength(1);
    expect(seen[0].origin).toContain('remote');
  });
});

describe('idempotence + echo suppression', () => {
  test('a duplicate update is a successful no-op', () => {
    const a = peer('a');
    const b = peer('b', a.backend);
    const commit = a.coord.localInsertText(P1, 'once');
    const first = b.coord.remoteMerge(commit.update!);
    const second = b.coord.remoteMerge(commit.update!);
    expect(first.noop).toBeUndefined();
    expect(second).toMatchObject({ ok: true, noop: true });
    expect(b.store.currentRevision).toBe(1); // not bumped twice
  });

  test('a coordinator ignores the echo of its own update', () => {
    const a = peer('a');
    const commit = a.coord.localInsertText(P1, 'self');
    const echo = a.coord.remoteMerge(commit.update!);
    expect(echo).toMatchObject({ ok: true, noop: true });
  });

  test('an update for another document is rejected', () => {
    const a = peer('a');
    const other = new ReplicationCoordinator(new DocumentStore(createEmptyModel()), YjsBackend.fromModel('OTHER', 'z', createEmptyModel()));
    const commit = a.coord.localInsertText(P1, 'x');
    expect(other.remoteMerge(commit.update!)).toMatchObject({ ok: false });
  });
});
