/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review rail renders a card only for its own data. A reply that another participant
// makes or edits is that card's data too: the local rail shows them, and renders no
// other card for them.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { act, cleanup } from '@testing-library/react';
import { collaborationModule, reviewModule } from '../../index.ts';
import { installRailGeometry } from '../../__tests__/review-rail-metrics-harness.ts';
import {
  cardOf,
  installViewHeight,
  mountedCards,
  pagedTrackedDocument,
} from '../../__tests__/review-rail-render-work-harness.ts';
import {
  countingRail,
  mountRail,
  settle,
} from '../../__tests__/review-rail-render-work-react-harness.tsx';
import { createPeerHarness } from './document-peer-support';
import { packageFingerprint } from './document-support';
import {
  mountRemoteEditor,
  remoteKeyOf,
  unmountRemoteEditors,
} from './review-rail-remote-support.ts';

const harness = createPeerHarness('review-rail-remote-update', { offlineEditing: true });
let restore: (() => void)[] = [];
beforeAll(() => {
  restore = [installRailGeometry(), installViewHeight()];
});
afterAll(() => {
  for (const undo of restore) undo();
});
afterEach(() => {
  cleanup();
  unmountRemoteEditors();
  harness.cleanup();
});

test('a remote reply and a remote edit of it render only the card they belong to', async () => {
  const pair = await harness.pair(pagedTrackedDocument());
  pair.alice.detach();
  pair.bob.detach();
  const { rail, cards, reset } = countingRail();
  const { container, editor: alice } = await mountRail(rail, {
    source: pair.alice.room.document,
    modules: [reviewModule(), collaborationModule({ session: pair.alice.room.session })],
  });
  const bob = mountRemoteEditor(pair.bob);
  await settle();
  /** Run `change` on the remote editor, deliver it, and let the local rail render. */
  const remote = async (change: () => { readonly ok: boolean }): Promise<void> => {
    await act(async () => {
      expect(change().ok).toBe(true);
      pair.bob.room.session.flushPendingJournals();
      pair.alice.room.session.flushPendingJournals();
    });
    await settle();
  };
  const converged = (): boolean =>
    packageFingerprint(alice.surface!.session.currentPackage()) ===
    packageFingerprint(bob.surface!.session.currentPackage());
  const mounted = mountedCards(container);
  expect(mounted.length).toBeGreaterThan(1);
  const [first] = mounted;
  const replies = () => [
    ...cardOf(container, first!)!.querySelectorAll<HTMLElement>('[data-testid="review-reply"]'),
  ];

  // The first reply adds its author to the rail, which every card's author colors follow.
  await remote(() => bob.replyToReviewItem(remoteKeyOf(bob, 'added 0'), 'first answer'));
  expect(replies().map((reply) => reply.textContent)).toEqual([
    expect.stringContaining('first answer'),
  ]);
  expect(replies()[0]!.dataset.reviewAuthor).toBe('Bob');

  // From then on a remote reply is the data of one card.
  reset();
  await remote(() => bob.replyToReviewItem(remoteKeyOf(bob, 'added 0'), 'second answer'));
  expect(replies()).toHaveLength(2);
  expect(replies()[1]!.textContent).toContain('second answer');
  expect(cards.keys()).toEqual([first!]);

  // A remote edit of the reply reaches the card through the card's own replies.
  reset();
  await remote(() => bob.setCommentText(remoteKeyOf(bob, 'second answer'), 'third answer'));
  expect(replies()[1]!.textContent).toContain('third answer');
  expect(cards.keys()).toEqual([first!]);

  // A remote accept takes its card away, and the card with the replies keeps them.
  await remote(() => bob.acceptReviewItem(remoteKeyOf(bob, 'added 1')));
  expect(mountedCards(container)).toContain(first!);
  expect(mountedCards(container)).not.toContain(mounted[1]!);
  expect(replies()).toHaveLength(2);
  expect(converged()).toBe(true);
});
