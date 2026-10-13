/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The path to a log service without an OpenTelemetry SDK: the browser batches events with
// `httpExporter`, a route checks them again with `telemetryRoute`, and `toLogRecord` shapes them
// for the service. Plus `filter` and `browserPrivacySignals`.
import { afterEach, describe, expect, test } from 'bun:test';
import type { EditorDiagnostic } from '@docx-editor.dev/core';
import {
  browserPrivacySignals,
  createTelemetry,
  httpExporter,
  isFailure,
  memoryExporter,
} from '../index.ts';
import { telemetryRoute, toLogRecord, validateTelemetryEvents } from '../ingest/index.ts';

const base = { schemaVersion: 1, editorSessionId: 'e_0123456789abcdef', time: 1_791_900_000_000 };
const refusal = {
  ...base,
  kind: 'edit.rejected',
  code: 'edit.picture-selected',
  origin: 'command',
  tracked: false,
} as EditorDiagnostic;
const opened = {
  ...base,
  kind: 'document.open',
  outcome: 'opened',
  sizeBucket: '0-64KiB',
  durationMs: 120,
} as EditorDiagnostic;

const realFetch = globalThis.fetch;
const realBeacon = globalThis.navigator?.sendBeacon;
/** What `sendBeacon` received; it accepts while `beaconAccepts` is true. */
let beacons: unknown[][] = [];
let beaconAccepts = true;

function stubBeacon(): void {
  beacons = [];
  Object.defineProperty(globalThis.navigator, 'sendBeacon', {
    configurable: true,
    value: (_url: string, body: Blob) => {
      if (!beaconAccepts) return false;
      void body.text().then((text) => beacons.push(JSON.parse(text)));
      return true;
    },
  });
}

afterEach(() => {
  globalThis.fetch = realFetch;
  beaconAccepts = true;
  if (globalThis.navigator)
    Object.defineProperty(globalThis.navigator, 'sendBeacon', {
      configurable: true,
      value: realBeacon,
    });
});

describe('httpExporter', () => {
  test('posts full batches, and sends the rest with sendBeacon when the page closes', async () => {
    stubBeacon();
    const posts: unknown[][] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const telemetry = createTelemetry({
      exporters: [httpExporter({ url: '/api/telemetry', batchSize: 2, flushIntervalMs: 60_000 })],
    });
    telemetry.record(refusal);
    telemetry.record({ ...refusal, code: 'edit.read-only' } as EditorDiagnostic);
    telemetry.record({ ...refusal, code: 'edit.protected-content' } as EditorDiagnostic);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toHaveLength(2);
    await telemetry.flush();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts).toHaveLength(1);
    expect(beacons.map((batch) => batch.length)).toEqual([1]);
  });

  test('falls back to fetch when sendBeacon refuses, and reports a failed request', async () => {
    stubBeacon();
    beaconAccepts = false;
    const errors: unknown[] = [];
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const telemetry = createTelemetry({
      exporters: [httpExporter({ url: '/api/telemetry', onError: (error) => errors.push(error) })],
    });
    telemetry.record(refusal);
    await telemetry.flush();
    expect(errors).toHaveLength(1);
  });
});

describe('filter', () => {
  test('keeps only the events the host asks for; metrics still count them', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({
      exporters: [memory],
      filter: (event) => isFailure(event) || event.kind === 'performance',
    });
    telemetry.record(opened);
    telemetry.record(refusal);
    expect(memory.events.map((event) => event.kind)).toEqual(['edit.rejected']);
    expect(memory.metrics.some((record) => record.definition.name.includes('document.opens'))).toBe(
      true
    );
  });
});

describe('browserPrivacySignals', () => {
  const before = Object.fromEntries(
    ['navigator', 'localStorage', 'window', 'document'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ])
  );
  afterEach(() => {
    for (const [key, descriptor] of Object.entries(before)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  });
  const define = (key: string, value: unknown) =>
    Object.defineProperty(globalThis, key, { value, configurable: true });

  test('refuses on Global Privacy Control, Do Not Track, or the opt-out key', () => {
    const store = new Map<string, string>();
    define('window', {});
    define('document', {});
    define('localStorage', { getItem: (key: string) => store.get(key) ?? null });
    const consent = browserPrivacySignals({ optOutKey: 'app:telemetry' });
    define('navigator', {});
    expect(consent()).toBe(true);
    define('navigator', { globalPrivacyControl: true });
    expect(consent()).toBe(false);
    define('navigator', { doNotTrack: '1' });
    expect(consent()).toBe(false);
    define('navigator', {});
    store.set('app:telemetry', 'off');
    expect(consent()).toBe(false);
  });

  test('outside a browser page there is no consent, even with a navigator', () => {
    define('navigator', {});
    define('window', undefined);
    expect(browserPrivacySignals()()).toBe(false);
  });
});

describe('httpExporter delivery limits', () => {
  test('consent withdrawn before a flush discards the waiting events', async () => {
    stubBeacon();
    let allowed = true;
    const posts: unknown[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      posts.push(init.body);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const telemetry = createTelemetry({
      exporters: [httpExporter({ url: '/api/telemetry' })],
      consent: () => allowed,
    });
    telemetry.record(refusal);
    allowed = false;
    await telemetry.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts).toEqual([]);
    expect(beacons).toEqual([]);
  });

  test('a throwing onError never surfaces as an unhandled rejection', async () => {
    stubBeacon();
    beaconAccepts = false;
    globalThis.fetch = (async () => new Response(null, { status: 500 })) as unknown as typeof fetch;
    const telemetry = createTelemetry({
      exporters: [
        httpExporter({
          url: '/api/telemetry',
          onError: () => {
            throw new Error('observer failed');
          },
        }),
      ],
    });
    telemetry.record(refusal);
    await expect(telemetry.flush()).resolves.toBeUndefined();
  });

  test('a closing page sends at most about 60 KiB and reports what it dropped', async () => {
    stubBeacon();
    const errors: unknown[] = [];
    const big = (index: number) =>
      ({
        ...refusal,
        code: 'edit.read-only',
        editorSessionId: `e_${'x'.repeat(40)}${index}`,
      }) as never;
    const withErrors = httpExporter({
      url: '/api/telemetry',
      batchSize: 1000,
      flushIntervalMs: 60_000,
      onError: (error) => errors.push(error),
    });
    // Each event is about 200 bytes; 600 of them are far over the closing budget.
    for (let index = 0; index < 600; index += 1) withErrors.event!(big(index));
    await withErrors.flush!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sentBytes = beacons.reduce(
      (total, batch) => total + new TextEncoder().encode(JSON.stringify(batch)).byteLength,
      0
    );
    expect(sentBytes).toBeLessThanOrEqual(60 * 1024);
    expect(errors).toHaveLength(1);
  });
});

describe('ingest', () => {
  const sent = {
    ...refusal,
    engineVersion: 'development',
    resource: { 'service.name': 'site', note: 'Confidential settlement terms' },
    attributes: { 'app.version': '4.2.0', token: 'sk_live_secret123', name: 'Alice' },
  };

  test('validation keeps complete known events and drops everything a client chose', () => {
    const events = validateTelemetryEvents([
      sent,
      { ...base, kind: 'page.view', url: '/x' },
      { ...sent, code: 'edit.made-up' },
      { kind: 'edit.rejected' },
      { ...sent, origin: undefined },
      { ...sent, command: 'Confidential' },
    ]);
    // Only the first is complete and known; a made-up command drops its whole event.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ code: 'edit.picture-selected', resource: {} });
    expect(events[0]).not.toHaveProperty('attributes');
    const text = JSON.stringify(events);
    for (const secret of ['Confidential', 'sk_live', 'Alice', 'site'])
      expect(text).not.toContain(secret);
    expect(validateTelemetryEvents({ events: [sent] })).toEqual([]);
    expect(validateTelemetryEvents(Array.from({ length: 51 }, () => sent))).toEqual([]);
  });

  test('attributeKeys keeps only the listed keys, with identifier values', () => {
    const [event] = validateTelemetryEvents([sent], { attributeKeys: ['app.version', 'note'] });
    expect(event).toMatchObject({ attributes: { 'app.version': '4.2.0' }, resource: {} });
    expect(JSON.stringify(event)).not.toContain('Confidential');
  });

  test('a log record has dt and message, and no fixed help text', () => {
    const [event] = validateTelemetryEvents([{ ...sent, hint: 'x', docs: 'y' }]);
    const record = toLogRecord(event!);
    expect(record).toMatchObject({
      dt: base.time,
      message: 'edit.rejected edit.picture-selected',
    });
    expect(record).not.toHaveProperty('hint');
    expect(record).not.toHaveProperty('docs');
  });

  test('the route forwards checked events, limits bytes, and always answers 204', async () => {
    const forwarded: unknown[] = [];
    const errors: unknown[] = [];
    const route = telemetryRoute({
      forward: (events) => {
        forwarded.push(...events);
        return new Response(null, { status: forwarded.length > 1 ? 403 : 202 });
      },
      allowedOrigins: ['https://app.example.com'],
      maxBodyBytes: 4 * 1024,
      onError: (error) => errors.push(error),
    });
    // A browser request carries Origin; a script cannot set it on `new Request`, so this stands in.
    const post = (text: string, origin = 'https://app.example.com', method = 'POST') =>
      route({
        method,
        headers: new Headers({ 'content-type': 'application/json', origin }),
        body: new Response(text).body,
      } as unknown as Request);
    expect((await post(JSON.stringify([sent]))).status).toBe(204);
    expect(forwarded).toHaveLength(1);
    expect((await post(JSON.stringify([sent]), 'https://evil.example')).status).toBe(204);
    expect((await post('not json')).status).toBe(204);
    // Multibyte text: few characters, many bytes, and no Content-Length.
    expect((await post(JSON.stringify(['ż'.repeat(3000)]))).status).toBe(204);
    expect((await post(JSON.stringify([sent]), undefined, 'GET')).status).toBe(204);
    expect(forwarded).toHaveLength(1);
    // The log service refused: the route still answers 204 and reports it.
    expect((await post(JSON.stringify([sent]))).status).toBe(204);
    expect(errors).toHaveLength(1);
  });
});
