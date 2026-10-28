// Run in a plain Bun process: the unit-test DOM preload replaces the native fetch types.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { catalogBytes } from './catalog-bytes.ts';

const bytes = new Uint8Array([1, 2, 3]);
const hash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const timeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = (milliseconds) => {
  assert.equal(milliseconds, 15_000);
  return timeout(100);
};

const scenario = process.argv[2];
let requests = 0;
const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  async fetch() {
    requests += 1;
    if (scenario === 'headers' && requests === 1) await delay(500);
    if (scenario === 'timeouts') await delay(500);
    if (scenario === 'http' && requests === 1) return new Response(null, { status: 503 });
    if (scenario === 'body' && requests === 1) {
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(bytes.slice(0, 1));
            await delay(500);
            controller.enqueue(bytes.slice(1));
            controller.close();
          },
        })
      );
    }
    if (scenario === 'length') return new Response(new Uint8Array([1]));
    if (scenario === 'hash') return new Response(new Uint8Array([3, 2, 1]));
    return new Response(bytes);
  },
});

try {
  const download = () => catalogBytes(server.url.href, bytes.byteLength, hash, 'Synthetic');
  if (scenario === 'transport') {
    globalThis.fetch = Object.assign(
      () => {
        requests += 1;
        return Promise.reject(new TypeError('unreachable'));
      },
      { preconnect: globalThis.fetch.preconnect }
    );
    await assert.rejects(download, /3 attempts failed; last error unreachable/);
    assert.equal(requests, 3);
  } else if (scenario === 'timeouts') {
    await assert.rejects(download, /3 attempts failed/);
    assert.equal(requests, 3);
  } else if (scenario === 'length' || scenario === 'hash') {
    await assert.rejects(download, /Catalog bytes changed for Synthetic/);
    assert.equal(requests, 1);
  } else {
    assert.ok(['headers', 'body', 'http'].includes(scenario!));
    assert.deepEqual(await download(), bytes);
    assert.equal(requests, 2);
  }
} finally {
  server.stop(true);
}
