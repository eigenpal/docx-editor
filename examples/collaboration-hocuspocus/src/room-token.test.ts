import { describe, expect, test } from 'bun:test';
import { roomToken } from './room-token.ts';

describe('room token', () => {
  test('a starting tab asks to create the room only until its first sync', () => {
    const tokens = roomToken({ create: 'create', join: 'join', creating: true });
    expect(tokens.token()).toBe('create');
    // A reconnect before the first sync may still create the room.
    expect(tokens.token()).toBe('create');
    tokens.markJoined();
    // Every reconnect after it only joins, so a lost or retired room is refused, not seeded.
    expect(tokens.token()).toBe('join');
    expect(tokens.token()).toBe('join');
  });

  test('an invited tab only ever joins', () => {
    const tokens = roomToken({ create: 'create', join: 'join', creating: false });
    expect(tokens.token()).toBe('join');
    tokens.markJoined();
    expect(tokens.token()).toBe('join');
  });
});
