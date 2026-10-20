import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createTarballVerifier } from './publication-tarball.mjs';
import { verifyPublication } from './publication.mjs';

const bytes = 'tested package bytes';
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
const published = {
  name: '@docx-editor.dev/core',
  version: '2.23.0',
  dist: {
    integrity,
    tarball: 'https://registry.npmjs.org/@docx-editor.dev/core/-/core-2.23.0.tgz',
  },
};

test('metadata success waits for downloadable matching archive bytes', async () => {
  let time = 0;
  let calls = 0;
  const verifyArchive = createTarballVerifier({
    fetch: async () => (++calls === 1 ? new Response('', { status: 404 }) : new Response(bytes)),
    now: () => time,
    wait: async (ms: number) => {
      time += ms;
    },
    log: () => {},
  });
  await verifyPublication(
    { packages: { [published.name]: { version: published.version, integrity } } },
    {
      lookup: async () => published,
      verifyArchive,
      now: () => time,
      log: () => {},
    }
  );
  expect(calls).toBe(2);
  expect(time).toBe(5000);
});

test('downloaded bytes must match the candidate even when metadata matches', async () => {
  let calls = 0;
  const verify = createTarballVerifier({
    fetch: async () => {
      calls++;
      return new Response('wrong');
    },
  });
  await expect(verify(published)).rejects.toThrow('differs');
  expect(calls).toBe(1);
});

test('archive retries respect the shared deadline and Retry-After', async () => {
  let time = 0;
  const pauses: number[] = [];
  const verify = createTarballVerifier({
    fetch: async () => new Response('', { status: 429, headers: { 'retry-after': '20' } }),
    now: () => time,
    wait: async (ms: number) => {
      pauses.push(ms);
      time += ms;
    },
    log: () => {},
  });
  await expect(verify(published, { deadline: 25000 })).rejects.toThrow('timed out');
  expect(pauses).toEqual([20000, 5000]);
});

test('permanent HTTP errors and cancelled requests stop immediately', async () => {
  let calls = 0;
  const verify = createTarballVerifier({
    fetch: async () => {
      calls++;
      return new Response('', { status: 403 });
    },
  });
  await expect(verify(published)).rejects.toThrow('HTTP 403');
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  await expect(verify(published, { signal: controller.signal })).rejects.toThrow('cancelled');
  expect(calls).toBe(1);
});
