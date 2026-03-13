import { expect, test } from 'bun:test';

import { PERF_ENABLED } from './perfFlags';

test('PERF_ENABLED defaults to false when unset', () => {
  expect(PERF_ENABLED).toBe(false);
});
