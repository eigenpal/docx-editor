/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import { resolveWebrtcRoomPassword } from '../webrtc.ts';

const ROOM_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET = 'bbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('webrtc room password', () => {
  test('does not default the encryption key to the public room id', () => {
    expect(resolveWebrtcRoomPassword({})).toBeUndefined();
    expect(
      resolveWebrtcRoomPassword({
        href: `https://example.com/edit?room=${ROOM_ID}`,
      })
    ).toBeUndefined();
  });

  test('uses an explicit password and ignores the room query', () => {
    expect(
      resolveWebrtcRoomPassword({
        password: SECRET,
        href: `https://example.com/edit?room=${ROOM_ID}`,
      })
    ).toBe(SECRET);
  });

  test('reads a collab fragment so two peers with the same link share a key', () => {
    expect(
      resolveWebrtcRoomPassword({
        href: `https://example.com/edit?room=${ROOM_ID}#collab=${SECRET}`,
      })
    ).toBe(SECRET);
  });

  test('rejects a fragment that is too short to be a secret', () => {
    expect(
      resolveWebrtcRoomPassword({
        href: `https://example.com/edit?room=${ROOM_ID}#collab=short`,
      })
    ).toBeUndefined();
  });
});
