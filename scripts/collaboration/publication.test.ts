import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRegistryClient, PUBLICATION_TIMEOUT_MS } from './registry.mjs';
import { readPublicationCandidate, verifyPublication } from './publication.mjs';
import { validateRecoverySource, validateRecoveryPackages } from './recovery.mjs';

const name = '@docx-editor.dev/core';
const version = '2.19.0';
const published = { name, version, dist: { integrity: 'sha512-tested' } };
const manifest = { packages: { [name]: { version, integrity: published.dist.integrity } } };
const response = (status: number, body = {}, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers });
function client(reply: (url: string, time: number) => Response | Promise<Response>) {
  let time = 0;
  const pauses: number[] = [];
  const messages: string[] = [];
  const urls: string[] = [];
  const lookup = createRegistryClient({
    now: () => time,
    random: () => 1,
    log: (message: string) => messages.push(message),
    wait: async (ms: number) => {
      pauses.push(ms);
      time += ms;
    },
    fetch: async (url: string) => {
      urls.push(url);
      return reply(url, time);
    },
  });
  return { lookup, pauses, messages, urls, elapsed: () => time };
}

test('publication can become visible after the former two-minute deadline', async () => {
  const c = client((_url, time) => (time >= 180_000 ? response(200, published) : response(404)));
  expect(await c.lookup(name, version, { waitForPublication: true })).toEqual(published);
  expect(c.elapsed()).toBeGreaterThan(120_000);
  expect(c.elapsed()).toBeLessThan(PUBLICATION_TIMEOUT_MS);
  expect(c.messages[0]).toContain('HTTP 404');
});

test('package metadata fallback selects the exact version even when latest differs', async () => {
  const c = client((url) =>
    url.endsWith('/' + version)
      ? response(404)
      : response(200, {
          'dist-tags': { latest: '99.0.0' },
          versions: { [version]: published, '99.0.0': { version: '99.0.0' } },
        })
  );
  expect(await c.lookup(name, version, { waitForPublication: true })).toEqual(published);
  expect(c.pauses).toHaveLength(0);
});

test('missing exact version never falls back to latest and stops at the shared deadline', async () => {
  const c = client((url) =>
    url.endsWith('/' + version)
      ? response(404)
      : response(200, {
          'dist-tags': { latest: '99.0.0' },
          versions: { '99.0.0': published },
        })
  );
  await expect(
    c.lookup(name, version, { waitForPublication: true, deadline: 125_000 })
  ).rejects.toThrow('timed out');
  expect(c.elapsed()).toBe(125_000);
});

for (const value of ['120', new Date(120_000).toUTCString()]) {
  test(`honors Retry-After ${value} before requesting the fallback`, async () => {
    const c = client((_url, time) =>
      time === 0 ? response(429, {}, { 'retry-after': value }) : response(200, published)
    );
    await c.lookup(name, version, { waitForPublication: true });
    expect(c.pauses).toEqual([120_000]);
    expect(c.urls).toHaveLength(2);
  });
}

test('network and server failures are retried', async () => {
  const c = client((_url, time) => {
    if (time === 0) throw new Error('ECONNRESET');
    return time < 20_000 ? response(503) : response(200, published);
  });
  expect(await c.lookup(name, version, { waitForPublication: true })).toEqual(published);
});

for (const status of [400, 401, 403]) {
  test(`HTTP ${status} fails immediately`, async () => {
    const c = client(() => response(status));
    await expect(c.lookup(name, version, { waitForPublication: true })).rejects.toThrow(
      `HTTP ${status}`
    );
    expect(c.urls).toHaveLength(1);
    expect(c.pauses).toHaveLength(0);
  });
}

test('nonpublication lookups do not wait for a missing version', async () => {
  const c = client(() => response(404));
  await expect(c.lookup(name, version)).rejects.toThrow('HTTP 404');
  expect(c.pauses).toHaveLength(0);
});

test('all packages start together, share one deadline, and cancel on integrity mismatch', async () => {
  const calls: { deadline: number; signal: AbortSignal }[] = [];
  const other = '@docx-editor.dev/react';
  let cancelled = false;
  const lookup = async (
    pkg: string,
    _version: string,
    options: { deadline: number; signal: AbortSignal }
  ) => {
    calls.push(options);
    if (pkg === name) return { ...published, dist: { integrity: 'sha512-wrong' } };
    return new Promise((_resolve, reject) =>
      options.signal.addEventListener('abort', () => {
        cancelled = true;
        reject(options.signal.reason);
      })
    );
  };
  await expect(
    verifyPublication(
      { packages: { ...manifest.packages, [other]: manifest.packages[name] } },
      { lookup, now: () => 10, log: () => {} }
    )
  ).rejects.toThrow('differs');
  expect(calls).toHaveLength(2);
  expect(calls.map((call) => call.deadline)).toEqual([600_010, 600_010]);
  expect(cancelled).toBe(true);
});

test('published metadata must match name and exact version as well as integrity', async () => {
  for (const changed of [{ version: '2.18.0' }, { name: 'other' }, { dist: undefined }]) {
    await expect(
      verifyPublication(manifest, {
        lookup: async () => ({ ...published, ...changed }),
        log: () => {},
      })
    ).rejects.toThrow('differs');
  }
});

test('archived candidate rejects previews, empty packages, unsafe paths, and altered bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'publication-test-'));
  const hash = (algorithm: string, value: string, encoding: 'hex' | 'base64' = 'hex') =>
    createHash(algorithm).update(value).digest(encoding);
  const candidate = {
    preview: false,
    lockHash: hash('sha256', 'lock'),
    packages: {
      [name]: {
        filename: 'core.tgz',
        version,
        hash: hash('sha256', 'tarball'),
        integrity: 'sha512-' + hash('sha512', 'tarball', 'base64'),
      },
    },
  };
  const save = (value: unknown) =>
    writeFileSync(join(dir, 'candidate.json'), JSON.stringify(value));
  try {
    writeFileSync(join(dir, 'package-lock.json'), 'lock');
    writeFileSync(join(dir, 'core.tgz'), 'tarball');
    save(candidate);
    expect(readPublicationCandidate(dir)).toEqual(candidate);
    for (const changed of [
      { ...candidate, preview: true },
      { ...candidate, packages: {} },
      { ...candidate, lockHash: 'changed' },
      {
        ...candidate,
        packages: { [name]: { ...candidate.packages[name], filename: '../core.tgz' } },
      },
    ]) {
      save(changed);
      expect(() => readPublicationCandidate(dir)).toThrow();
    }
    save(candidate);
    writeFileSync(join(dir, 'core.tgz'), 'different');
    expect(() => readPublicationCandidate(dir)).toThrow('tarball changed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const repository = 'eigenpal/docx-editor';
const source = {
  repository: { full_name: repository },
  head_repository: { full_name: repository },
  path: '.github/workflows/release.yml',
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  head_sha: 'abc',
};
const jobs = [
  { name: 'Release', steps: [{ name: 'Release PR or Publish', conclusion: 'success' }] },
];
test('recovery requires the original repository, release workflow, main, tag, and successful publication', () => {
  const options = { repository, version, commit: 'abc' };
  expect(() => validateRecoverySource(source, jobs, options)).not.toThrow();
  for (const changed of [
    { path: '.github/workflows/ci.yml' },
    { event: 'pull_request' },
    { head_branch: 'other' },
    { head_sha: 'other' },
    { status: 'in_progress' },
    { repository: { full_name: 'other/repo' } },
    { head_repository: { full_name: 'fork/repo' } },
  ]) {
    expect(() => validateRecoverySource({ ...source, ...changed }, jobs, options)).toThrow();
  }
  expect(() => validateRecoverySource(source, [], options)).toThrow('publication');
});

test('recovery rejects omitted, extra, or differently versioned packages', () => {
  expect(() =>
    validateRecoveryPackages(
      manifest,
      [
        { name, version },
        { name: 'private', private: true },
      ],
      version
    )
  ).not.toThrow();
  for (const packages of [
    [],
    [{ name, version: '2.18.0' }],
    [
      { name, version },
      { name: 'extra', version },
    ],
  ]) {
    expect(() => validateRecoveryPackages(manifest, packages, version)).toThrow('tagged release');
  }
});

test('cancelling a registry request does not start another attempt', async () => {
  const controller = new AbortController();
  let requests = 0;
  const lookup = createRegistryClient({
    fetch: async (_url: string, options: { signal: AbortSignal }) => {
      requests++;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), {
          once: true,
        });
      });
    },
    log: () => {},
  });
  const pending = lookup(name, version, { waitForPublication: true, signal: controller.signal });
  controller.abort(new Error('another package failed integrity verification'));
  await expect(pending).rejects.toThrow('another package failed integrity verification');
  expect(requests).toBe(1);
});

test('an unresponsive request is aborted within the remaining publication budget', async () => {
  let aborted = false;
  const lookup = createRegistryClient({
    fetch: async (_url: string, options: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            reject(options.signal.reason);
          },
          { once: true }
        );
      }),
    log: () => {},
  });
  await expect(
    lookup(name, version, { waitForPublication: true, deadline: Date.now() + 100 })
  ).rejects.toThrow('timed out');
  expect(aborted).toBe(true);
});
