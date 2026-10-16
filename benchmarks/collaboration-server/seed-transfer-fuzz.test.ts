// Seeded scenarios for server-seeded rooms on a real Hocuspocus server. See
// `seed-transfer-fuzz.ts` for what each seed does and checks. Run more seeds with
// `bun seed-transfer-fuzz.ts <first seed> <count>`.

import { describe, expect, test } from 'bun:test';
import { runSeedScenario } from './seed-transfer-fuzz.ts';

const SEEDS = Number(process.env.SEED_TRANSFER_SEEDS ?? 6);

describe('server-seeded rooms', () => {
  test(
    `${SEEDS} seeded scenarios converge without a seed echo`,
    async () => {
      const failures: string[] = [];
      for (let seed = 1; seed <= SEEDS; seed += 1) {
        const result = await runSeedScenario(seed);
        if (result.problems.length > 0) {
          failures.push(`seed ${seed}: ${result.problems.join(' | ')}\n  ${result.summary}`);
        }
      }
      expect(failures).toEqual([]);
    },
    { timeout: 30_000 * SEEDS }
  );

  test('the checks find the echo when a participant seeds the room', async () => {
    const result = await runSeedScenario(3, { seededBy: 'participant' });
    expect(result.problems.some((problem) => problem.includes('sent a seed-sized'))).toBe(true);
  }, 60_000);

  test('the checks find the second copy when the server does not flush the loaded room', async () => {
    const result = await runSeedScenario(3, { flushAfterLoad: false });
    expect(result.problems.some((problem) => problem.includes('seed-sized messages'))).toBe(true);
  }, 60_000);

  test('the checks find a server that seeds a known room again after its state is lost', async () => {
    // Seed 5 loses the stored state at the end.
    const result = await runSeedScenario(5, { refuseLostRooms: false });
    expect(result.summary).toContain('lose storage');
    expect(result.problems).toContain('the server seeded the lost room again');
    expect(result.problems).toContain(
      'the reconnecting participant reported error:room-generation-changed, not saved-room-unavailable'
    );
  }, 60_000);
});
