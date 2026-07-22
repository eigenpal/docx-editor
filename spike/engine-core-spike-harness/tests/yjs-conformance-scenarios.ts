/** @spike-features yjs-backend */
import { createDocOpBatch, type BackendConformanceScenario } from '../src';

const STORY = 'story-body-0';

export const scenarios: BackendConformanceScenario[] = [
  {
    name: 'insert-delete',
    expectRepair: false,
    batches: [
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'insertText', storyId: STORY, blockId: 'block-para-010', offset: 0, text: 'X' }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-insert'],
          },
        }),
      },
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-001', start: 1, end: 4 }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-delete'],
          },
        }),
      },
    ],
  },
  {
    name: 'split-join-identity',
    batches: [
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'splitParagraph', storyId: STORY, blockId: 'block-para-010', offset: 2 }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-split'],
          },
        }),
      },
      {
        batch: createDocOpBatch({
          ops: [
            {
              kind: 'joinParagraphs',
              storyId: STORY,
              firstBlockId: 'block-para-010',
              secondBlockId: 'block-para-010-tail',
            },
          ],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-join'],
          },
        }),
      },
    ],
  },
  {
    name: 'validation-failure',
    expectFailure: true,
    batches: [
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-999', start: 0, end: 1 }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-bad'],
          },
        }),
      },
    ],
  },
  {
    name: 'no-op',
    expectNoOp: true,
    batches: [
      {
        batch: createDocOpBatch({
          ops: [{ kind: 'deleteRange', storyId: STORY, blockId: 'block-para-010', start: 2, end: 2 }],
          transaction: {
            actorId: 'actor-alice',
            sessionId: 'session-alice-1',
            groupId: 'group-alice-1',
            constituentIds: ['op-noop'],
          },
        }),
      },
    ],
  },
];
