import { expect, test } from 'bun:test';
import { newerJob, type Job } from '../src/api';
const job = (epoch: string, version: number, state: Job['state']): Job => ({
  id: 'job',
  epoch,
  version,
  state,
  proposals: 1,
  mode: 'scripted',
  instruction: 'Review',
  message: state,
});
test('a reconnect replaces observed but unpersisted progress, and late old HTTP cannot restore it', () => {
  const observed = job('worker-before-crash', 10, 'proposing');
  const recovered = job('worker-after-crash', 8, 'interrupted');
  const current = newerJob(observed, recovered, 'stream');
  expect(current).toEqual(recovered);
  expect(newerJob(current, job('worker-before-crash', 11, 'proposing'), 'response')).toEqual(
    recovered
  );
});
test('delayed HTTP and old snapshots cannot regress a completed job within an epoch', () => {
  const completed = job('worker', 10, 'completed');
  expect(newerJob(completed, job('worker', 3, 'reading'))).toEqual(completed);
  expect(newerJob(completed, job('worker', 3, 'reading'), 'stream')).toEqual(completed);
  expect(newerJob(completed, null, 'stream')).toEqual(completed);
  const next = { ...job('worker', 11, 'connecting'), id: 'next-job' };
  expect(newerJob(completed, next)).toEqual(next);
  expect(newerJob(next, completed)).toEqual(next);
});
