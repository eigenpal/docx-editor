import { describe, expect, test } from 'bun:test';
import { replaceObjectUrls, revokeObjectUrls } from './object-url-lifecycle';

describe('preview object URL lifecycle', () => {
  test('releases replacement, stale, failed, and unmounted leases exactly once', () => {
    const revoked: string[] = [];
    const revoke = (url: string) => revoked.push(url);

    const active = replaceObjectUrls(['old'], ['active'], revoke);
    revokeObjectUrls(['stale', 'stale'], revoke);
    revokeObjectUrls(['failed'], revoke);
    revokeObjectUrls(active, revoke);

    expect(revoked).toEqual(['old', 'stale', 'failed', 'active']);
  });
});
