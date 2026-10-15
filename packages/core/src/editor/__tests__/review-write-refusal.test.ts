// `reviewWriteRefusal` turns the reason `commitReviewOps` returned into a review command's answer.

import { describe, expect, test } from 'bun:test';
import { reviewWriteRefusal } from '../review-write-refusal.ts';
import { REFRESH_WRITE_REFUSAL } from '../refresh-write-guard.ts';
import { READ_ONLY_PROTECTION_REASON } from '../opening-editing-mode.ts';

describe('reviewWriteRefusal', () => {
  test('a write that refused without a reason keeps the fallback and its code', () => {
    expect(reviewWriteRefusal(null, 'the reply could not be committed')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'the reply could not be committed',
    });
    expect(reviewWriteRefusal('rejected', 'not resolved', 'notFound')).toEqual({
      ok: false,
      code: 'notFound',
      reason: 'not resolved',
    });
  });

  test('viewing and protection refusals answer locked with their own reason', () => {
    expect(reviewWriteRefusal('the document is open for viewing', 'x')).toEqual({
      ok: false,
      code: 'locked',
      reason: 'the document is open for viewing',
    });
    expect(reviewWriteRefusal(READ_ONLY_PROTECTION_REASON, 'x').code).toBe('locked');
  });

  test('a refresh or collaboration refusal names itself', () => {
    expect(reviewWriteRefusal(REFRESH_WRITE_REFUSAL, 'x')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: REFRESH_WRITE_REFUSAL,
    });
    expect(reviewWriteRefusal('collaboration-session-not-ready', 'x').reason).toBe(
      'collaboration-session-not-ready'
    );
  });
});
