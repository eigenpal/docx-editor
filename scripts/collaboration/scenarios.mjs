import assert from 'node:assert/strict';
import { Peer } from './peer.mjs';

export const TEXT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const BODY = 'compatibility-room';
export function shuffle(values, seed) {
  const shuffled = [...values];
  let state = seed >>> 0;
  for (let i = shuffled.length - 1; i > 0; i--) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const index = state % (i + 1);
    [shuffled[i], shuffled[index]] = [shuffled[index], shuffled[i]];
  }
  return shuffled;
}
async function synchronize(peers, format, seed, roomId = BODY) {
  for (let round = 0; round < 20; round++) {
    const held = [];
    for (const source of peers) {
      for (const update of await source.request('drain')) {
        for (const target of peers) if (target !== source) held.push({ target, update });
      }
    }
    if (!held.length) return;
    for (const { target, update } of shuffle(held, seed + round)) {
      await target.request('apply', { format, roomId, update });
      await target.request('apply', { format, roomId, update });
    }
  }
  throw new Error('Replicas did not settle within 20 delivery rounds');
}
function withoutDocument({ document, ...snapshot }) {
  return snapshot;
}
async function converged(peers, expected) {
  const snapshots = [];
  for (const peer of peers) {
    const snapshot = await peer.request('snapshot');
    assert.equal(
      snapshot.paragraphs[0],
      expected,
      `${peer.label}: unexpected text: ${JSON.stringify(snapshot.paragraphs)}`
    );
    assert.deepEqual(
      withoutDocument(await peer.request('export')),
      snapshot,
      `${peer.label}: export differs from editor`
    );
    snapshots.push(snapshot);
  }
  for (const snapshot of snapshots.slice(1))
    assert.deepEqual(snapshot, snapshots[0], 'Replica content differs');
  return snapshots[0];
}
const edit = (peer, operation, paragraph = 0) => peer.request('edit', { operation, paragraph });
const format = (peer, start, end, name) =>
  edit(peer, { op: 'setRunProperties', start, end, properties: [{ localName: name }] });

export async function mixedScenario(
  oldDirectory,
  candidateDirectory,
  fixture,
  seed,
  candidateCreates,
  trace
) {
  const directories = candidateCreates
    ? [candidateDirectory, oldDirectory, candidateDirectory]
    : [oldDirectory, candidateDirectory, oldDirectory];
  const peers = directories.map(
    (directory, i) =>
      new Peer(
        directory,
        `seed-${seed}-peer-${i}-${candidateCreates ? 'candidate-seeds' : 'release-seeds'}`,
        trace
      )
  );
  const [alice, bob, carol] = peers;
  try {
    const info = await alice.request('info');
    for (const peer of peers) assert.equal((await peer.request('info')).format, info.format);
    await alice.request('open', { roomId: BODY, actor: 'alice', document: fixture.document });
    const state = await alice.request('state');
    await bob.request('open', { roomId: BODY, actor: 'bob', state });
    await carol.request('open', { roomId: BODY, actor: 'carol', state });
    const original = await converged(peers, TEXT);
    assert.deepEqual(original, fixture.expected, 'Published fixture content changed');
    // Three disconnected writers; delivery is shuffled and duplicated after each round.
    for (const [start, end] of [
      [2, 32],
      [8, 26],
      [14, 20],
    ]) {
      await format(alice, start, end, 'b');
      await format(bob, start + 1, end - 1, 'i');
      await format(carol, start + 2, end - 2, 'u');
      await synchronize(peers, info.format, seed);
      await converged(peers, TEXT);
    }
    await edit(alice, { op: 'insertText', offset: 17, text: 'typed' });
    await format(bob, 10, 25, 'b');
    await synchronize(peers, info.format, seed);
    let expected = TEXT.slice(0, 17) + 'typed' + TEXT.slice(17);
    await converged(peers, expected);
    await edit(bob, { op: 'deleteText', start: 12, end: 25 });
    expected = expected.slice(0, 12) + expected.slice(25);
    await synchronize(peers, info.format, seed);
    await converged(peers, expected);
    // Concurrent deletion and insertion at separate positions have one explicit outcome.
    await edit(alice, { op: 'deleteText', start: 0, end: 1 });
    await edit(bob, { op: 'insertText', offset: expected.length, text: '!' });
    expected = expected.slice(1) + '!';
    await synchronize(peers, info.format, seed);
    await converged(peers, expected);
    // Remount from persisted state. Undo starts empty, then undo/redo covers one local edit.
    const saved = await carol.request('state');
    await carol.request('open', { roomId: BODY, actor: 'carol-reconnected', state: saved });
    assert.equal(await carol.request('undo'), false);
    await edit(carol, { op: 'insertText', offset: 0, text: 'UNDO' });
    await synchronize(peers, info.format, seed);
    await converged(peers, 'UNDO' + expected);
    assert.equal(await carol.request('undo'), true);
    await synchronize(peers, info.format, seed);
    await converged(peers, expected);
    assert.equal(await carol.request('redo'), true);
    await synchronize(peers, info.format, seed);
    expected = 'UNDO' + expected;
    await converged(peers, expected);
    // This regression fixes candidate writes. Released peers must read the result;
    // their pre-existing authoring bug is not a new format incompatibility.
    const fixedWriter = peers[candidateCreates ? 0 : 1];
    await edit(fixedWriter, { op: 'splitParagraph', offset: 4 });
    await synchronize(peers, info.format, seed);
    const split = await converged(peers, expected.slice(0, 4));
    assert.equal(split.paragraphs[1], expected.slice(4));
    await edit(fixedWriter, { op: 'joinParagraphs' });
    await synchronize(peers, info.format, seed);
    const final = await converged(peers, expected);
    assert.deepEqual(final.binary, original.binary, 'Embedded assets changed');
    assert.deepEqual(
      final.paragraphs.slice(1),
      original.paragraphs.slice(1),
      'Unedited content changed'
    );
    for (const [part, fingerprint] of original.fingerprint) {
      if (part !== '/word/document.xml')
        assert.deepEqual(
          final.fingerprint.find(([name]) => name === part),
          [part, fingerprint]
        );
    }
  } finally {
    await Promise.allSettled(peers.map((peer) => peer.close()));
  }
}

export async function savedRoomScenario(oldDirectory, candidateDirectory, fixture, trace) {
  const old = new Peer(oldDirectory, 'old-exporter', trace);
  const next = new Peer(candidateDirectory, 'replacement', trace);
  const second = new Peer(candidateDirectory, 'replacement-second', trace);
  try {
    const oldInfo = await old.request('info'),
      nextInfo = await next.request('info');
    const inspection = await next.request('inspect', { state: fixture.state });
    assert.equal(inspection.unchanged, true);
    assert.equal(inspection.format, oldInfo.format);
    assert.equal(!!inspection.error, oldInfo.format !== nextInfo.format);
    await old.request('open', { roomId: 'old-room', actor: 'exporter', state: fixture.state });
    const before = await old.request('hash');
    const exported = await old.request('export');
    assert.equal(await old.request('hash'), before, 'Export changed the old room');
    assert.deepEqual(withoutDocument(exported), fixture.expected);
    if (oldInfo.format === nextInfo.format) {
      await next.request('open', { roomId: 'old-room', actor: 'restore', state: fixture.state });
      assert.deepEqual(
        await next.request('snapshot'),
        fixture.expected,
        'Candidate cannot restore published state'
      );
    }
    // Rehearse export/reseed even before the first post-2.18 format change.
    const storage = new Map([['old-room', fixture.state]]);
    await next.request('open', {
      roomId: 'replacement-room',
      actor: 'new',
      document: exported.document,
    });
    assert.deepEqual(await next.request('snapshot'), fixture.expected, 'Migration changed content');
    assert.equal(await next.request('undo'), false, 'Migration retained old undo history');
    storage.set('replacement-room', await next.request('state'));
    await second.request('open', {
      roomId: 'replacement-room',
      actor: 'second',
      state: storage.get('replacement-room'),
    });
    const newBefore = await next.request('hash');
    await assert.rejects(
      next.request('apply', { roomId: 'old-room', format: oldInfo.format, update: fixture.state })
    );
    assert.equal(
      await next.request('hash'),
      newBefore,
      'Rejected old update changed the replacement'
    );
    await assert.rejects(
      second.request('apply', {
        roomId: 'replacement-room',
        format: 'unknown-format',
        update: fixture.state,
      })
    );
    await edit(next, { op: 'insertText', offset: 0, text: 'new ' });
    await synchronize([next, second], nextInfo.format, 2180, 'replacement-room');
    await converged([next, second], 'new ' + TEXT);
    // Preserve new edits for reconciliation before an operator routes back to the old room.
    const recovery = await next.request('export');
    assert.equal(recovery.paragraphs[0], 'new ' + TEXT);
    assert.equal(storage.get('old-room'), fixture.state);
    assert.equal(await old.request('hash'), before);
  } finally {
    await Promise.allSettled([old, next, second].map((peer) => peer.close()));
  }
}

export async function basicSplitScenario(oldDirectory, candidateDirectory, fixture, trace) {
  const peers = [
    new Peer(oldDirectory, 'basic-release-writer', trace),
    new Peer(candidateDirectory, 'basic-candidate-writer', trace),
  ];
  try {
    const info = await peers[0].request('info');
    for (const author of peers) {
      await peers[0].request('open', {
        roomId: BODY,
        actor: 'basic-old',
        document: fixture.document,
      });
      await peers[1].request('open', {
        roomId: BODY,
        actor: 'basic-new',
        state: await peers[0].request('state'),
      });
      await edit(author, { op: 'splitParagraph', offset: 4 });
      await synchronize(peers, info.format, 2180);
      const snapshot = await converged(peers, TEXT.slice(0, 4));
      assert.equal(snapshot.paragraphs[1], TEXT.slice(4));
      await edit(author, { op: 'joinParagraphs' });
      await synchronize(peers, info.format, 2180);
      await converged(peers, TEXT);
    }
  } finally {
    await Promise.allSettled(peers.map((peer) => peer.close()));
  }
}
