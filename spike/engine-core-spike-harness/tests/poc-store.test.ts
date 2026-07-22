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

  test('local text undo preserves remote text', async () => {
    const loaded = await loadedFixture();
    const local = createReplica(loaded, 'actor-local', 'session-local', 701);
    const remote = createReplica(loaded, 'actor-remote', 'session-remote', 702);

    remote.insert(0, 'R');
    applyDiff(local, remote);
    local.insert(1, 'L');
    expect(local.undo()).toBe(true);
    expect(local.snapshot().text).toBe('RHello bold italic');
    expect(remote.snapshot().text).toBe('RHello bold italic');
  });

  test('local same-kind formatting undo preserves remote contribution', async () => {
    const loaded = await loadedFixture();
    const local = createReplica(loaded, 'actor-local', 'session-local', 801);
    const remote = createReplica(loaded, 'actor-remote', 'session-remote', 802);

    remote.toggleMark(0, 5, 'bold');
    applyDiff(local, remote);
    local.toggleMark(6, 10, 'bold');
    expect(local.undo()).toBe(true);
    expect(local.snapshot().runs).toEqual([
      { text: 'Hello', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'bold', bold: true, italic: false },
      { text: ' ', bold: false, italic: false },
      { text: 'italic', bold: false, italic: true },
    ]);
  });

  test('observed disable preserves unseen concurrent enable', async () => {
    const loaded = await loadedFixture();
    const observed = createReplica(loaded, 'actor-alice', 'session-alice', 901);
    const disabling = createReplica(loaded, 'actor-alice', 'session-alice', 902);
    const unseen = createReplica(loaded, 'actor-carol', 'session-carol', 903);

    observed.toggleMark(0, 4, 'bold');
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
    expect(orderDU.snapshot().runs.some((run) => run.bold && run.text === ' ')).toBe(true);
    expect(orderDU.snapshot().runs.some((run) => run.bold && run.text === 'Hell')).toBe(false);
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
