import { expect, test } from 'bun:test';
import { createLiveFontResolution } from '../live-font-resolution.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('static configurations initialize without scanning document font needs on load or edits', async () => {
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
  expect(resolutions).toBe(1);
  expect(scans).toBe(0);
});
