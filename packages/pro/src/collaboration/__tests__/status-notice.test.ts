/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { collaborationNoticeOf } from '../status-notice.ts';

const ready = {
  status: 'ready' as const,
  reasonCode: undefined,
  recovering: false,
  waiting: false,
  stalled: false,
  refusedRecently: false,
  offlineEditing: true,
};

describe('the collaboration notice', () => {
  test('says nothing while everything is in order', () => {
    expect(collaborationNoticeOf(ready)).toBeNull();
    expect(collaborationNoticeOf({ ...ready, status: 'inactive' })).toBeNull();
  });

  test('tells offline users whether they can keep editing', () => {
    expect(collaborationNoticeOf({ ...ready, status: 'disconnected' })).toBe('offline');
    expect(collaborationNoticeOf({ ...ready, status: 'disconnected', offlineEditing: false })).toBe(
      'offlinePaused'
    );
  });

  test('offers a rejoin only where a rejoin helps', () => {
    const error = { ...ready, status: 'error' as const };
    expect(collaborationNoticeOf({ ...error, reasonCode: 'remote-apply-failed' })).toBe(
      'outOfSync'
    );
    expect(
      collaborationNoticeOf({ ...error, reasonCode: 'remote-apply-failed', recovering: true })
    ).toBe('syncing');
    expect(collaborationNoticeOf({ ...error, reasonCode: 'schema-version-mismatch' })).toBe(
      'upgradeRequired'
    );
    expect(collaborationNoticeOf({ ...error, reasonCode: 'concurrent-seed' })).toBe(
      'newRoomRequired'
    );
    expect(collaborationNoticeOf({ ...error, reasonCode: 'too-many-nodes' })).toBe(
      'newRoomRequired'
    );
  });

  test('a wait that lasts turns into a stalled notice', () => {
    expect(collaborationNoticeOf({ ...ready, waiting: true })).toBe('waiting');
    expect(collaborationNoticeOf({ ...ready, waiting: true, stalled: true })).toBe('stalled');
    // A stalled flag left from an earlier wait means nothing once edits go through.
    expect(collaborationNoticeOf({ ...ready, stalled: true })).toBeNull();
  });

  test('a refused edit shows while the session is ready', () => {
    expect(collaborationNoticeOf({ ...ready, refusedRecently: true })).toBe('editRefused');
  });
});
