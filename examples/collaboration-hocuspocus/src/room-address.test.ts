import { describe, expect, test } from 'bun:test';
import { roomAddress } from './room-address.ts';

const ROOM = 'a'.repeat(48);

describe('room address', () => {
  test('a starting tab names its room only after the first connect succeeded', () => {
    const href = 'http://localhost:5176/';
    expect(roomAddress({ href, roomId: ROOM, creating: true, connected: false })).toBeNull();
    expect(roomAddress({ href, roomId: ROOM, creating: true, connected: true })).toBe(
      `http://localhost:5176/?room=${ROOM}`
    );
  });

  test('an invited tab keeps the room its link names, without other parameters', () => {
    const href = `http://localhost:5176/?room=${ROOM}`;
    expect(roomAddress({ href, roomId: ROOM, creating: false, connected: false })).toBeNull();
    expect(
      roomAddress({ href: `${href}&ref=mail`, roomId: ROOM, creating: false, connected: false })
    ).toBe(href);
  });
});
