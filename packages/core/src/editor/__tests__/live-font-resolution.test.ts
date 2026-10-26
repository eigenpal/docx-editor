import { expect, test } from 'bun:test';
import { createLiveFontResolution } from '../live-font-resolution.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('static configurations scan document font needs once on load and never on edits', async () => {
  let scans = 0;
  let resolutions = 0;
  const queue = createLiveFontResolution(
    () => ({
      generation: 1,
      dynamic: false,
      families: () => {
        scans++;
        return ['Calibri'];
      },
    }),
    async () => {
      resolutions++;
    }
  );
  queue.schedule(true);
  await tick();
  queue.schedule();
  await tick();
  // The load scan feeds the substitution plan: a family the configuration lacks needs it.
  expect(resolutions).toBe(1);
  expect(scans).toBe(1);
});

test('late faces install after the resolution in flight, and only for their generation', async () => {
  let generation = 1;
  const order: string[] = [];
  let finishFirst!: () => void;
  const queue = createLiveFontResolution<string>(
    () => ({ generation, dynamic: true, families: () => ['Calibri'] }),
    async (_families, late) => {
      order.push(late ?? 'resolve');
      if (!late) await new Promise<void>((resolve) => (finishFirst = resolve));
    }
  );
  queue.schedule(true);
  queue.deliver(1, 'late');
  await tick();
  expect(order).toEqual(['resolve']);
  finishFirst();
  await tick();
  expect(order).toEqual(['resolve', 'late']);

  generation = 2;
  queue.schedule(true);
  finishFirst();
  await tick();
  queue.deliver(1, 'stale');
  await tick();
  expect(order).toEqual(['resolve', 'late', 'resolve']);
});
