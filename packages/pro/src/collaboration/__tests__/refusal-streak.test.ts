/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A refused local edit realigns the replica and editing continues. Repeated refusals mean the
// next edit refuses too, so the session stops. A refusal that waits on a peer's update gets
// more room, but not forever: a source that never arrives must not refuse every edit in that
// run for the life of the room.
import { describe, expect, test } from 'bun:test';
import { RefusalStreak } from '../document-session-heal.ts';

describe('refusal streak', () => {
  test('three refusals in a row end recovery', () => {
    const streak = new RefusalStreak();
    streak.refusedOne(false);
    streak.refusedOne(false);
    expect(streak.recoverable()).toBe(true);
    streak.refusedOne(false);
    expect(streak.recoverable()).toBe(false);
  });

  test('a clean publish ends the streak', () => {
    const streak = new RefusalStreak();
    streak.refusedOne(false);
    streak.refusedOne(false);
    streak.published();
    streak.refusedOne(false);
    streak.refusedOne(false);
    expect(streak.recoverable()).toBe(true);
  });

  test('refusals that wait on a peer count only after twenty in a row', () => {
    const streak = new RefusalStreak();
    for (let index = 0; index < 20; index += 1) streak.refusedOne(true);
    expect(streak.recoverable()).toBe(true);
    for (let index = 0; index < 3; index += 1) streak.refusedOne(true);
    expect(streak.recoverable()).toBe(false);
  });
});
