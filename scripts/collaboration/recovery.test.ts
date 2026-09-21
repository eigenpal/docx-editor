import { expect, test } from 'bun:test';
import { createRegistryClient, PUBLICATION_TIMEOUT_MS } from './registry.mjs';
import { verifyRecoveryPublication } from './recovery.mjs';

const name = '@docx-editor.dev/core';
const converter = '@docx-editor.dev/docx-to-markdown';
const version = '2.21.1';
const published = { name, version, dist: { integrity: 'sha512-tested' } };
const manifest = { packages: { [name]: { version, integrity: published.dist.integrity } } };

function client(reply: (url: string, time: number) => Response | Promise<Response>) {
  let time = 0;
  const messages: string[] = [];
  const requests: string[] = [];
  const lookup = createRegistryClient({
    now: () => time,
    random: () => 1,
    wait: async (ms: number) => {
      time += ms;
    },
    log: (message: string) => messages.push(message),
    fetch: async (url: string) => {
      requests.push(url);
      return reply(url, time);
    },
  });
  return {
    lookup,
    now: () => time,
    log: (message: string) => messages.push(message),
    messages,
    requests,
  };
}

const response = (value: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers });
const tags = (latest: unknown) => response({ 'dist-tags': { latest } });

test('recovery waits when integrity is valid but latest tags still report an older release', async () => {
  const c = client((url, time) =>
    url.endsWith('/' + version) ? response(published) : tags(time < 180_000 ? '2.21.0' : version)
  );
  await verifyRecoveryPublication(manifest, version, c);
  expect(c.now()).toBeGreaterThanOrEqual(180_000);
  expect(c.now()).toBeLessThan(PUBLICATION_TIMEOUT_MS);
  expect(c.messages.some((message) => message.includes('latest is still 2.21.0'))).toBe(true);
  expect(c.messages).toContain(`Verified ${name} latest is ${version}`);
  expect(c.messages).toContain(`Verified ${converter} latest is ${version}`);
});

test('current tags finish immediately without a fixed delay', async () => {
  const c = client((url) => (url.endsWith('/' + version) ? response(published) : tags(version)));
  await verifyRecoveryPublication(manifest, version, c);
  expect(c.now()).toBe(0);
  expect(c.requests).toHaveLength(3);
});

test('missing latest tags and transient tag requests recover within the publication budget', async () => {
  const attempts = new Map<string, number>();
  const c = client((url) => {
    if (url.endsWith('/' + version)) return response(published);
    const attempt = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, attempt);
    if (attempt === 1) return response({}, 429, { 'retry-after': '20' });
    if (attempt === 2) return response({});
    if (attempt === 3) throw new Error('ECONNRESET');
    return tags(version);
  });
  await verifyRecoveryPublication(manifest, version, c);
  expect(c.now()).toBeGreaterThanOrEqual(45_000);
  expect(c.messages.some((message) => message.includes('HTTP 429'))).toBe(true);
  expect(c.messages.some((message) => message.includes('latest tag is missing'))).toBe(true);
});

test('integrity and latest-tag propagation share one deadline', async () => {
  const c = client((url, time) => {
    if (url.endsWith('/' + version))
      return time >= 480_000 ? response(published) : response({}, 404);
    return response({ versions: {}, 'dist-tags': { latest: '2.21.0' } });
  });
  await expect(verifyRecoveryPublication(manifest, version, c)).rejects.toThrow('timed out');
  expect(c.now()).toBe(PUBLICATION_TIMEOUT_MS);
  expect(c.messages).toContain('Published artifact integrity matches the tested candidate.');
  expect(c.messages.some((message) => message.includes('latest is still 2.21.0'))).toBe(true);
});

test('a genuinely newer latest version rejects recovery without waiting', async () => {
  for (const newer of ['2.21.2', '2.22.0', '2.100.0', '3.0.0']) {
    const c = client((url) => (url.endsWith('/' + version) ? response(published) : tags(newer)));
    await expect(verifyRecoveryPublication(manifest, version, c)).rejects.toThrow(
      `superseded by latest ${newer}`
    );
    expect(c.now()).toBe(0);
  }
});

test('unexpected latest tags and authentication failures fail immediately', async () => {
  for (const value of [42, {}, 'not-a-version', '2.22.0-rc.1']) {
    const c = client((url) => (url.endsWith('/' + version) ? response(published) : tags(value)));
    await expect(verifyRecoveryPublication(manifest, version, c)).rejects.toThrow(
      'Unexpected latest'
    );
    expect(c.now()).toBe(0);
  }
  const c = client((url) =>
    url.endsWith('/' + version) ? response(published) : response({}, 403)
  );
  await expect(verifyRecoveryPublication(manifest, version, c)).rejects.toThrow('HTTP 403');
  expect(c.now()).toBe(0);
});

test('an integrity mismatch prevents any latest-tag check', async () => {
  const c = client(() => response({ ...published, dist: { integrity: 'sha512-different' } }));
  await expect(verifyRecoveryPublication(manifest, version, c)).rejects.toThrow('differs');
  expect(c.requests).toHaveLength(1);
  expect(c.now()).toBe(0);
});

test('a superseded release cancels the other pending latest-tag request', async () => {
  let cancelled = false;
  const lookup = createRegistryClient({
    fetch: async (url: string, options: { signal: AbortSignal }) => {
      if (url.endsWith('/' + version)) return response(published);
      if (url.includes(encodeURIComponent(name))) return tags('2.22.0');
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          'abort',
          () => {
            cancelled = true;
            reject(options.signal.reason);
          },
          { once: true }
        );
      });
    },
    log: () => {},
  });
  await expect(
    verifyRecoveryPublication(manifest, version, { lookup, log: () => {} })
  ).rejects.toThrow('superseded');
  expect(cancelled).toBe(true);
});
