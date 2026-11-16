import assert from 'node:assert/strict';
import { Peer } from './peer.mjs';
import { synchronize } from './scenarios.mjs';

/** Released readers interpret replacement paragraph lineage exactly like candidate readers. */
export async function commentEditScenario(oldDirectory, candidateDirectory, fixture, trace) {
  const peers = [
    new Peer(oldDirectory, 'comment-old', trace),
    new Peer(candidateDirectory, 'comment-a', trace),
    new Peer(candidateDirectory, 'comment-b', trace),
  ];
  const [old, alice, bob] = peers;
  const roomId = 'comment-compatibility';
  try {
    const info = await old.request('info');
    await old.request('open', { roomId, actor: 'old', document: fixture.document });
    const baseline = await old.request('comments');
    const id = await old.request('comment', { action: 'add', text: 'Original' });
    for (const [index, peer] of [alice, bob].entries())
      await peer.request('open', {
        roomId,
        actor: `new-${index}`,
        state: await old.request('state'),
      });
    const sync = () => synchronize(peers, info.format, 1681, roomId);
    const equal = async () => {
      const states = await Promise.all(peers.map((peer) => peer.request('snapshot')));
      for (const state of states.slice(1)) assert.deepEqual(state, states[0]);
      for (const peer of peers) {
        const { document, ...exported } = await peer.request('export');
        assert.deepEqual(exported, states[0]);
      }
    };
    await sync();
    await alice.request('comment', { action: 'edit', commentId: id, text: 'Alice replacement' });
    await bob.request('comment', { action: 'edit', commentId: id, text: 'Bob replacement' });
    await sync();
    await equal();
    const comments = await old.request('comments');
    assert.equal(comments.length, baseline.length + 1);
    assert.deepEqual(
      comments.filter((comment) => comment.id !== id),
      baseline
    );
    assert.ok(
      ['Alice replacement', 'Bob replacement'].includes(
        comments.find((comment) => comment.id === id)?.text
      )
    );
    // Released clients continue ordinary comment writes against the replacement body.
    const replyId = await old.request('comment', {
      action: 'reply',
      commentId: id,
      text: 'Released reply',
    });
    await alice.request('comment', { action: 'edit', commentId: id, text: 'Final text' });
    await sync();
    await equal();
    await old.request('comment', { action: 'resolve', commentId: id, resolved: true });
    await bob.request('comment', { action: 'edit', commentId: id, text: 'Resolved text' });
    await sync();
    await equal();
    assert.deepEqual(
      (await old.request('comments'))
        .filter((comment) => comment.id === id || comment.id === replyId)
        .map((comment) => comment.text)
        .sort(),
      ['Released reply', 'Resolved text']
    );
    const state = await old.request('state');
    await old.request('open', { roomId, actor: 'old-rejoined', state });
    await equal();
  } finally {
    await Promise.allSettled(peers.map((peer) => peer.close()));
  }
}
