import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { createPocDocxFixture, loadPocDocx, type LoadedPocDocx } from '../src/poc/docx';
import {
  createPocStore,
  getDeterministicBootstrapUpdate,
  type PocSnapshot,
  type PocStore,
} from '../src/poc/store';

const EXPECTED_RUNS = [
  { text: 'Hello ', bold: false, italic: false },
  { text: 'bold', bold: true, italic: false },
  { text: ' ', bold: false, italic: false },
  { text: 'italic', bold: false, italic: true },
] as const;

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

async function loadedFixture(): Promise<LoadedPocDocx> {
  return loadPocDocx(await createPocDocxFixture());
}

function createReplica(
  loaded: LoadedPocDocx,
  actorId: string,
  sessionId: string,
  clientId: number
): PocStore {
  return createPocStore(loaded, { actorId, sessionId, clientId });
}

function diffUpdate(source: PocStore, target: PocStore): Uint8Array {
  const sourceDoc = new Y.Doc({ gc: false });
  Y.applyUpdate(sourceDoc, source.encodeUpdate());
  const targetDoc = new Y.Doc({ gc: false });
  Y.applyUpdate(targetDoc, target.encodeUpdate());
  return Y.encodeStateAsUpdate(sourceDoc, Y.encodeStateVector(targetDoc));
}

function applyDiff(target: PocStore, source: PocStore): void {
  target.applyRemoteUpdate(diffUpdate(source, target));
}

function snapshotFingerprint(snapshot: PocSnapshot): string {
  return JSON.stringify(snapshot);
}

function decodeStore(store: PocStore): Y.Doc {
  const doc = new Y.Doc({ gc: false });
  Y.applyUpdate(doc, store.encodeUpdate());
  return doc;
}

function contributionKeys(store: PocStore): string[] {
  return [...decodeStore(store).getMap('markContributions').keys()].sort();
}

function maliciousMapUpdate(
  target: PocStore,
  clientId: number,
  mutate: (doc: Y.Doc, body: Y.Text, marks: Y.Map<Record<string, unknown>>) => void
): Uint8Array {
  const doc = new Y.Doc({ gc: false });
  doc.clientID = clientId;
  Y.applyUpdate(doc, target.encodeUpdate());
  const before = Y.encodeStateVector(doc);
  const body = doc.getText('bodySequence');
  const marks = doc.getMap<Record<string, unknown>>('markContributions');
  doc.transact(() => mutate(doc, body, marks));
  return Y.encodeStateAsUpdate(doc, before);
}

describe('poc store', () => {
  test('exports createPocStore from the harness entrypoint', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.createPocStore).toBe('function');
  });

  test('initial snapshot matches loaded DOCX runs', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-a', 'session-a', 101);
    expect(store.snapshot()).toEqual({
      paragraphId: loaded.paragraphId,
      text: 'Hello bold italic',
      runs: EXPECTED_RUNS,
    });
  });

  test('bootstrap update is deterministic and replicas do not duplicate fixture content after sync', async () => {
    const loaded = await loadedFixture();
    const bootstrapA = getDeterministicBootstrapUpdate(loaded);
    const bootstrapB = getDeterministicBootstrapUpdate(loaded);
    expect(bytesEqual(bootstrapA, bootstrapB)).toBe(true);

    const left = createReplica(loaded, 'actor-left', 'session-left', 201);
    const right = createReplica(loaded, 'actor-right', 'session-right', 202);
    expect(left.snapshot()).toEqual(right.snapshot());

    left.insert(0, '!');
    applyDiff(right, left);
    expect(right.snapshot().text).toBe('!Hello bold italic');
    expect(right.snapshot().runs).toEqual([
      { text: '!Hello ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);
  });

  test('insert and delete edit paragraph text', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-edit', 'session-edit', 301);
    store.insert(6, 'X');
    expect(store.snapshot().text).toBe('Hello Xbold italic');
    store.delete(6, 7);
    expect(store.snapshot().text).toBe('Hello bold italic');
    store.delete(6, 10);
    expect(store.snapshot().text).toBe('Hello  italic');
  });

  test('rejects surrogate-splitting boundaries and invalid text', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-surrogate', 'session-surrogate', 401);
    const before = snapshotFingerprint(store.snapshot());
    const emoji = '\uD83D\uDE00';

    store.insert(0, emoji.slice(0, 1));
    expect(snapshotFingerprint(store.snapshot())).toBe(before);

    store.insert(1, emoji.slice(1));
    expect(snapshotFingerprint(store.snapshot())).toBe(before);

    store.insert(0, emoji);
    expect(store.snapshot().text.startsWith(emoji)).toBe(true);

    const afterInsert = snapshotFingerprint(store.snapshot());
    store.delete(0, 1);
    expect(snapshotFingerprint(store.snapshot())).toBe(afterInsert);

    store.delete(0, 2);
    expect(store.snapshot().text).toBe('Hello bold italic');

    store.insert(0, '');
    expect(store.snapshot().text).toBe('Hello bold italic');
  });

  test('toggle mark enables, fully-covered disable, and mixed coverage stays enabling', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-mark', 'session-mark', 501);

    store.toggleMark(0, 5, 'bold');
    expect(store.snapshot().runs).toEqual([
      { text: 'Hello', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);

    store.toggleMark(0, 5, 'bold');
    expect(store.snapshot().runs).toEqual(EXPECTED_RUNS);

    store.toggleMark(6, 10, 'italic');
    expect(store.snapshot().runs).toEqual([
      { text: 'Hello ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: true },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);

    store.toggleMark(0, 10, 'bold');
    expect(store.snapshot().runs).toEqual([
      { text: 'Hello ', bold: true, italic: false },
      { text: 'bold', bold: true, italic: true },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);

    store.toggleMark(6, 10, 'bold');
    expect(store.snapshot().runs).toEqual([
      { text: 'Hello ', bold: true, italic: false },
      { text: 'bold', bold: false, italic: true },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);
  });

  test('two replicas converge for both update orders after concurrent text and formatting', async () => {
    const loaded = await loadedFixture();
    const baseLeft = createReplica(loaded, 'actor-left', 'session-left', 601);
    const baseRight = createReplica(loaded, 'actor-right', 'session-right', 602);

    const runOrder = (applyFirst: 'left' | 'right') => {
      const left = createReplica(loaded, 'actor-left', 'session-left', 611);
      const right = createReplica(loaded, 'actor-right', 'session-right', 612);
      left.insert(0, '!');
      right.toggleMark(11, 17, 'bold');
      const leftUpdate = diffUpdate(left, baseRight);
      const rightUpdate = diffUpdate(right, baseLeft);
      if (applyFirst === 'left') {
        right.applyRemoteUpdate(leftUpdate);
        left.applyRemoteUpdate(rightUpdate);
      } else {
        left.applyRemoteUpdate(rightUpdate);
        right.applyRemoteUpdate(leftUpdate);
      }
      expect(left.snapshot()).toEqual(right.snapshot());
      expect(left.snapshot().text).toBe('!Hello bold italic');
      expect(left.snapshot().runs).toEqual([
        { text: '!Hello ', bold: false, italic: false },
        { text: 'bold', bold: true, italic: false },
        { text: ' ', bold: false, italic: false },
        { text: 'italic', bold: true, italic: true },
      ]);
    };

    runOrder('left');
    runOrder('right');
  });

  test('local text edit then remote text edit then local undo preserves remote text', async () => {
    const loaded = await loadedFixture();
    const local = createReplica(loaded, 'actor-local', 'session-local', 701);
    const remote = createReplica(loaded, 'actor-remote', 'session-remote', 702);

    local.insert(0, 'L');
    remote.applyRemoteUpdate(local.encodeUpdate());
    remote.insert(1, 'R');
    applyDiff(local, remote);
    expect(local.undo()).toBe(true);
    expect(local.snapshot().text).toBe('RHello bold italic');
  });

  test('local formatting then remote same-kind formatting then local undo preserves remote contribution', async () => {
    const loaded = await loadedFixture();
    const local = createReplica(loaded, 'actor-local', 'session-local', 801);
    const remote = createReplica(loaded, 'actor-remote', 'session-remote', 802);

    local.toggleMark(0, 5, 'bold');
    remote.applyRemoteUpdate(local.encodeUpdate());
    remote.toggleMark(4, 6, 'bold');
    applyDiff(local, remote);
    expect(local.undo()).toBe(true);
    expect(local.snapshot().runs.some((run) => run.bold && run.text.includes('o '))).toBe(true);
    expect(local.snapshot().runs.some((run) => run.bold && run.text === 'Hell')).toBe(false);
  });

  test('observed disable preserves unseen concurrent enable', async () => {
    const loaded = await loadedFixture();
    const observed = createReplica(loaded, 'actor-alice', 'session-alice', 901);
    const disabling = createReplica(loaded, 'actor-alice', 'session-alice', 902);
    const unseen = createReplica(loaded, 'actor-carol', 'session-carol', 903);

    observed.toggleMark(0, 2, 'bold');
    observed.toggleMark(2, 4, 'bold');
    const baseUpdate = observed.encodeUpdate();

    disabling.applyRemoteUpdate(baseUpdate);
    unseen.applyRemoteUpdate(baseUpdate);

    disabling.toggleMark(0, 4, 'bold');
    unseen.toggleMark(10, 11, 'bold');

    const disableUpdate = diffUpdate(disabling, observed);
    const unseenUpdate = diffUpdate(unseen, observed);

    const orderDU = createReplica(loaded, 'actor-merge', 'session-merge', 904);
    orderDU.applyRemoteUpdate(baseUpdate);
    orderDU.applyRemoteUpdate(disableUpdate);
    orderDU.applyRemoteUpdate(unseenUpdate);

    const orderUD = createReplica(loaded, 'actor-merge', 'session-merge', 905);
    orderUD.applyRemoteUpdate(baseUpdate);
    orderUD.applyRemoteUpdate(unseenUpdate);
    orderUD.applyRemoteUpdate(disableUpdate);

    expect(orderDU.snapshot()).toEqual(orderUD.snapshot());
    expect(orderDU.snapshot().runs.some((run) => run.bold && run.text.endsWith(' '))).toBe(true);
    expect(orderDU.snapshot().runs.some((run) => run.bold && run.text === 'Hell')).toBe(false);
    expect(disabling.undo()).toBe(true);
    disabling.applyRemoteUpdate(unseenUpdate);
    expect(disabling.snapshot().runs.some((run) => run.bold && run.text.endsWith(' '))).toBe(true);
  });

  test('true concurrent branches converge in neutral replicas in both update orders', async () => {
    const loaded = await loadedFixture();
    const left = createReplica(loaded, 'actor-concurrent-left', 'session-concurrent-left', 1401);
    const right = createReplica(loaded, 'actor-concurrent-right', 'session-concurrent-right', 1402);
    left.insert(0, 'L');
    right.insert(0, 'R');
    left.toggleMark(0, 1, 'bold');
    right.toggleMark(0, 1, 'italic');

    const orderLR = createReplica(loaded, 'actor-neutral-a', 'session-neutral-a', 1403);
    orderLR.applyRemoteUpdate(left.encodeUpdate());
    orderLR.applyRemoteUpdate(right.encodeUpdate());
    const orderRL = createReplica(loaded, 'actor-neutral-b', 'session-neutral-b', 1404);
    orderRL.applyRemoteUpdate(right.encodeUpdate());
    orderRL.applyRemoteUpdate(left.encodeUpdate());

    expect(orderLR.snapshot()).toEqual(orderRL.snapshot());
  });

  test('operation client IDs stay collision-free, live client stays stable, and no churn warning is emitted', async () => {
    const loaded = await loadedFixture();
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const store = createReplica(loaded, 'actor-stable', 'session-stable', 1501);
      expect(store.clientId).toBe(1501);
      store.insert(0, 'A');
      store.toggleMark(0, 1, 'bold');
      store.delete(0, 1);
      expect(store.clientId).toBe(1501);
      const clients = [...Y.decodeStateVector(Y.encodeStateVector(decodeStore(store))).keys()];
      expect(new Set(clients).size).toBe(clients.length);
      expect(warnings.flat().join(' ')).not.toMatch(/client-id|client id|collision/i);
    } finally {
      console.warn = originalWarn;
    }
  });

  test('recreated actor/session stores never reuse contribution keys', async () => {
    const loaded = await loadedFixture();
    const first = createReplica(loaded, 'actor-recreated', 'session-recreated', 1601);
    first.toggleMark(0, 5, 'bold');
    const firstKeys = contributionKeys(first);

    const sameClient = createReplica(loaded, 'actor-recreated', 'session-recreated', 1601);
    sameClient.applyRemoteUpdate(first.encodeUpdate());
    sameClient.toggleMark(10, 11, 'bold');
    const sameClientKeys = contributionKeys(sameClient);

    const distinctClient = createReplica(loaded, 'actor-recreated', 'session-recreated', 1602);
    distinctClient.applyRemoteUpdate(first.encodeUpdate());
    distinctClient.toggleMark(11, 12, 'bold');
    const distinctClientKeys = contributionKeys(distinctClient);

    expect(new Set(sameClientKeys).size).toBe(sameClientKeys.length);
    expect(new Set(distinctClientKeys).size).toBe(distinctClientKeys.length);
    expect(sameClientKeys.filter((key) => !firstKeys.includes(key))).toHaveLength(1);
    expect(distinctClientKeys.filter((key) => !firstKeys.includes(key))).toHaveLength(1);
  });

  test('rejects hidden duplicate assignments, overwrites, and exact-schema malformed records atomically', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-schema', 'session-schema', 1701);
    const before = snapshotFingerprint(store.snapshot());
    let notifications = 0;
    store.subscribe(() => (notifications += 1));

    const existingKey = contributionKeys(store)[0]!;
    const overwrite = maliciousMapUpdate(store, 1702, (_doc, _body, marks) => {
      marks.set(existingKey, { kind: 'add' });
    });
    store.applyRemoteUpdate(overwrite);

    const duplicate = maliciousMapUpdate(store, 1703, (_doc, _body, marks) => {
      marks.set('duplicate-key', { kind: 'add' });
      marks.set('duplicate-key', { kind: 'remove' });
    });
    store.applyRemoteUpdate(duplicate);

    const malformedRecords: Record<string, unknown>[] = [
      {
        kind: 'add',
        markKind: 'bold',
        actorId: 'a',
        commitId: 'c',
        relativeStart: 'AA',
        relativeEnd: 'AA',
        extra: true,
      },
      {
        kind: 'add',
        markKind: 'bold',
        actorId: 'a',
        commitId: 'c',
        relativeStart: 'AA',
        relativeEnd: 'AA',
      },
      {
        kind: 'remove',
        markKind: 'bold',
        actorId: 'a',
        commitId: 'c',
        relativeStart: 'AA',
        relativeEnd: 'AA',
        targetAddContributionIds: ['missing'],
      },
      {
        kind: 'remove',
        markKind: 'bold',
        actorId: 'a',
        commitId: 'c',
        relativeStart: 'AA',
        relativeEnd: 'AA',
        targetAddContributionIds: ['x', 'x'],
      },
      {
        kind: 'add',
        markKind: 'underline',
        actorId: 'a',
        commitId: 'c',
        relativeStart: 'AA',
        relativeEnd: 'AA',
      },
    ];
    malformedRecords.forEach((record, index) => {
      store.applyRemoteUpdate(
        maliciousMapUpdate(store, 1710 + index, (_doc, _body, marks) => {
          marks.set(`malformed-${index}`, record);
        })
      );
    });

    const nested = maliciousMapUpdate(store, 1720, (_doc, _body, marks) => {
      marks.set('nested', new Y.Map() as unknown as Record<string, unknown>);
    });
    store.applyRemoteUpdate(nested);

    expect(snapshotFingerprint(store.snapshot())).toBe(before);
    expect(notifications).toBe(0);
    expect(store.undo()).toBe(false);
  });

  test('rejects malformed body grammar, reversed endpoints, out-of-range endpoints, and unpaired UTF-16', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-body-schema', 'session-body-schema', 1801);
    const before = snapshotFingerprint(store.snapshot());

    const interiorEmbed = maliciousMapUpdate(store, 1802, (_doc, body) => {
      body.insertEmbed(1, { kind: 'paragraph-boundary', paragraphId: loaded.paragraphId });
    });
    store.applyRemoteUpdate(interiorEmbed);

    const unpaired = maliciousMapUpdate(store, 1803, (_doc, body) => {
      body.insert(1, '\uD800');
    });
    store.applyRemoteUpdate(unpaired);

    const malformedBoundary = maliciousMapUpdate(store, 1804, (_doc, body) => {
      body.delete(0, 1);
      body.insertEmbed(0, {
        kind: 'paragraph-boundary',
        paragraphId: loaded.paragraphId,
        extra: true,
      });
    });
    store.applyRemoteUpdate(malformedBoundary);

    expect(snapshotFingerprint(store.snapshot())).toBe(before);
  });

  test('projection coalesces adjacent identical runs and represents empty text deterministically', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-project', 'session-project', 1901);
    store.toggleMark(0, 3, 'bold');
    store.toggleMark(3, 5, 'bold');
    expect(store.snapshot().runs[0]).toEqual({ text: 'Hello', bold: true, italic: false });
    store.delete(0, store.snapshot().text.length);
    expect(store.snapshot()).toEqual({ paragraphId: loaded.paragraphId, text: '', runs: [] });
  });

  test('listener errors are isolated and reentrant mutations are queued after current delivery', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-listeners', 'session-listeners', 2001);
    const deliveries: string[] = [];
    store.subscribe((snapshot) => {
      deliveries.push(`first:${snapshot.text}`);
      if (snapshot.text.startsWith('A') && !snapshot.text.startsWith('AB')) store.insert(1, 'B');
      throw new Error('listener failure');
    });
    store.subscribe((snapshot) => deliveries.push(`second:${snapshot.text}`));

    expect(() => store.insert(0, 'A')).not.toThrow();
    expect(deliveries).toEqual([
      'first:AHello bold italic',
      'second:AHello bold italic',
      'first:ABHello bold italic',
      'second:ABHello bold italic',
    ]);
  });

  test('options are snapshotted through exact own data descriptors', async () => {
    const loaded = await loadedFixture();
    let accessorCalls = 0;
    const accessorOptions = Object.defineProperty(
      { sessionId: 'session-options', clientId: 2101 },
      'actorId',
      {
        enumerable: true,
        get() {
          accessorCalls += 1;
          return 'actor-options';
        },
      }
    );
    expect(() => createPocStore(loaded, accessorOptions as never)).toThrow(
      /options|descriptor|accessor/i
    );
    expect(accessorCalls).toBe(0);
    expect(() =>
      createPocStore(loaded, {
        actorId: 'actor-options',
        sessionId: 'session-options',
        clientId: 2101,
        extra: true,
      } as never)
    ).toThrow(/options|extra/i);

    const mutable = {
      actorId: 'actor-options',
      sessionId: 'session-options',
      clientId: 2101,
    };
    const store = createPocStore(loaded, mutable);
    mutable.actorId = 'actor-mutated';
    mutable.sessionId = 'session-mutated';
    mutable.clientId = 9999;
    store.toggleMark(0, 1, 'bold');
    expect(store.actorId).toBe('actor-options');
    expect(store.clientId).toBe(2101);
    expect(contributionKeys(store).some((key) => key.includes('actor-options'))).toBe(true);
    expect(contributionKeys(store).some((key) => key.includes('actor-mutated'))).toBe(false);
  });

  test('remote untracked work does not enter local undo', async () => {
    const loaded = await loadedFixture();
    const local = createReplica(loaded, 'actor-local', 'session-local', 1001);
    const remote = createReplica(loaded, 'actor-remote', 'session-remote', 1002);

    remote.insert(0, 'Z');
    local.applyRemoteUpdate(diffUpdate(remote, local));
    expect(local.undo()).toBe(false);
    expect(local.snapshot().text).toBe('ZHello bold italic');
  });

  test('update application is idempotent and listeners fire once per successful change only', async () => {
    const loaded = await loadedFixture();
    const source = createReplica(loaded, 'actor-source', 'session-source', 1101);
    const target = createReplica(loaded, 'actor-target', 'session-target', 1102);
    const notifications: PocSnapshot[] = [];

    const unsubscribe = target.subscribe((snapshot) => {
      notifications.push(snapshot);
    });

    source.insert(0, '!');
    const update = diffUpdate(source, target);
    target.applyRemoteUpdate(update);
    target.applyRemoteUpdate(update);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.text).toBe('!Hello bold italic');

    const beforeReject = snapshotFingerprint(target.snapshot());
    target.applyRemoteUpdate(new Uint8Array([9, 9, 9, 9]));
    expect(snapshotFingerprint(target.snapshot())).toBe(beforeReject);
    expect(notifications).toHaveLength(1);

    unsubscribe();
    source.insert(1, '?');
    target.applyRemoteUpdate(diffUpdate(source, target));
    expect(notifications).toHaveLength(1);
  });

  test('rejects malformed, oversized, wrong-root, and nested shared-type updates atomically', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-validate', 'session-validate', 1201);
    const before = snapshotFingerprint(store.snapshot());

    store.applyRemoteUpdate(new Uint8Array([0]));
    expect(snapshotFingerprint(store.snapshot())).toBe(before);

    store.applyRemoteUpdate(new Uint8Array(POC_MAX_UPDATE_BYTES + 1));
    expect(snapshotFingerprint(store.snapshot())).toBe(before);

    const wrongRoot = new Y.Doc({ gc: false });
    wrongRoot.getMap('root');
    store.applyRemoteUpdate(Y.encodeStateAsUpdate(wrongRoot));
    expect(snapshotFingerprint(store.snapshot())).toBe(before);

    const nested = new Y.Doc({ gc: false });
    nested.getMap('markContributions').set('nested', new Y.Map());
    store.applyRemoteUpdate(Y.encodeStateAsUpdate(nested));
    expect(snapshotFingerprint(store.snapshot())).toBe(before);
  });

  test('returns defensive snapshot and update copies without duplicate shared types', async () => {
    const loaded = await loadedFixture();
    const store = createReplica(loaded, 'actor-defensive', 'session-defensive', 1301);
    const snapshot = store.snapshot();
    const update = store.encodeUpdate();

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.runs)).toBe(true);
    expect(Object.isFrozen(snapshot.runs[0])).toBe(true);
    expect(update).not.toBe(store.encodeUpdate());

    store.insert(0, '!');
    expect(snapshot.text).toBe('Hello bold italic');

    const doc = new Y.Doc({ gc: false });
    Y.applyUpdate(doc, update);
    expect(doc.share.size).toBe(2);
    expect(doc.share.has('bodySequence')).toBe(true);
    expect(doc.share.has('markContributions')).toBe(true);
  });
});

const POC_MAX_UPDATE_BYTES = 256 * 1024;
