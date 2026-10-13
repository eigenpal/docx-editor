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
    globalThis.dispatchEvent(new Event('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts).toHaveLength(1);
    expect(beacons.map((batch) => batch.length)).toEqual([1]);
    await telemetry.shutdown();
  });

  test('a summary that fills a batch while the page hides still goes out with sendBeacon', async () => {
    stubBeacon();
    const posts: unknown[][] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const telemetry = createTelemetry({
      exporters: [httpExporter({ url: '/api/telemetry', batchSize: 2, flushIntervalMs: 60_000 })],
    });
    // The repeat is summarized at page hide, and the summary fills the batch of two.
    telemetry.record(refusal);
    telemetry.record(refusal);
    globalThis.dispatchEvent(new Event('pagehide'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(posts).toEqual([]);
    expect(beacons.flat()).toHaveLength(2);
    await telemetry.shutdown();
  });

  test('a flush while the page is open sends everything with fetch', async () => {
    stubBeacon();
    const posts: unknown[][] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const exporter = httpExporter({
      url: '/api/telemetry',
      batchSize: 50,
      flushIntervalMs: 60_000,
    });
    exporter.attach!({ consented: () => true, pageClosing: () => false });
    const many = (index: number) =>
      ({ ...refusal, editorSessionId: `e_${String(index).padStart(16, '0')}` }) as never;
    for (let index = 0; index < 49; index += 1) exporter.event!(many(index));
    await exporter.flush!();
    expect(beacons).toEqual([]);
    expect(posts.flat()).toHaveLength(49);
  });

  test('batchSize is at most 50, the route default for maxEvents', () => {
    const posts: unknown[][] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      posts.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    const exporter = httpExporter({
      url: '/api/telemetry',
      batchSize: 500,
      flushIntervalMs: 60_000,
    });
    for (let index = 0; index < 50; index += 1) exporter.event!(refusal as never);
    expect(posts.map((batch) => batch.length)).toEqual([50]);
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
    globalThis.dispatchEvent(new Event('pagehide'));
    await telemetry.flush();
    expect(errors).toHaveLength(1);
    await telemetry.shutdown();
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
    withErrors.attach!({ consented: () => true, pageClosing: () => true });
    // Each event is about 200 bytes; 600 of them are far over the closing budget.
    for (let index = 0; index < 600; index += 1) withErrors.event!(big(index));
    await withErrors.flush!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const sentBytes = beacons.reduce(
      (total, batch) => total + new TextEncoder().encode(JSON.stringify(batch)).byteLength,
      0
    );
    // The budget covers the whole closing period, not each batch.
    expect(sentBytes).toBeLessThanOrEqual(60 * 1024);
    expect(sentBytes).toBeGreaterThan(50 * 1024);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('httpExporter hidden pages', () => {
  const setVisibility = (state: string | undefined) => {
    if (state === undefined) delete (document as { visibilityState?: unknown }).visibilityState;
    else Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  afterEach(() => setVisibility(undefined));

  test('a batch filled while the document is hidden, before the window hears it, uses sendBeacon', () => {
    stubBeacon();
    const posts: unknown[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      posts.push(init);
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const telemetry = createTelemetry({
      exporters: [httpExporter({ url: '/api/telemetry', batchSize: 2, flushIntervalMs: 60_000 })],
    });
    telemetry.record(refusal);
    // The document is hidden; the engine's last summary arrives before the window's listener runs.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    telemetry.record({ ...refusal, code: 'edit.read-only' } as EditorDiagnostic);
    expect(posts).toEqual([]);
    void telemetry.shutdown();
  });

  test('each hidden period gets the whole closing budget', async () => {
    stubBeacon();
    const errors: unknown[] = [];
    const exporter = httpExporter({
      url: '/api/telemetry',
      flushIntervalMs: 60_000,
      onError: (error) => errors.push(error),
    });
    let hidden = false;
    exporter.attach!({ consented: () => true, pageClosing: () => hidden });
    // About 40 KiB per period: two periods together pass the budget, each one alone does not.
    const big = (index: number) =>
      ({ ...refusal, editorSessionId: `e_${String(index).padStart(64, '0')}` }) as never;
    for (let period = 0; period < 3; period += 1) {
      setVisibility('visible');
      hidden = true;
      for (let index = 0; index < 220; index += 1) exporter.event!(big(index));
      await exporter.flush!();
      setVisibility('hidden');
    }
    expect(errors).toEqual([]);
    await exporter.shutdown!();
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
    expect(events[0]!.attributes).toEqual({});
    const text = JSON.stringify(events);
    for (const secret of ['Confidential', 'sk_live', 'Alice', 'site'])
      expect(text).not.toContain(secret);
    expect(validateTelemetryEvents({ events: [sent] })).toEqual([]);
    // Free text in the session id or the version drops the event.
    expect(validateTelemetryEvents([{ ...sent, engineVersion: 'Confidential' }])).toEqual([]);
    expect(validateTelemetryEvents([{ ...sent, editorSessionId: 'e_Bearer-secret123' }])).toEqual(
      []
    );
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

  test('a log record carries the counts to sum, so a summary counts its repeats', () => {
    const [first, summary] = validateTelemetryEvents([sent, { ...sent, repeated: 4 }]);
    // `edit.picture-selected` is a failure: not one of the expected refusals.
    expect(toLogRecord(first!)).toMatchObject({ occurrences: 1, failures: 1 });
    expect(toLogRecord(summary!)).toMatchObject({ occurrences: 4, failures: 4, repeated: 4 });
    const [expected] = validateTelemetryEvents([{ ...sent, code: 'edit.read-only', repeated: 2 }]);
    expect(toLogRecord(expected!)).toMatchObject({ occurrences: 2, failures: 0 });
  });

  const openedSent = { ...opened, engineVersion: 'development' };

  test('a summary count must be a whole number of extra copies on a deduplicated kind', () => {
    const kept = (event: object) => validateTelemetryEvents([event]).length === 1;
    expect(kept({ ...sent, repeated: 1 })).toBe(true);
    expect(kept({ ...sent, repeated: 1_000_000 })).toBe(true);
    for (const repeated of [0, -5, 2.5, 1_000_001, 1e12, Number.NaN, Infinity, '4'])
      expect(kept({ ...sent, repeated })).toBe(false);
    // Opens, skipped tracked changes, participants, and performance summaries are never
    // deduplicated, so a `repeated` on them is removed and counts nothing.
    const participants = { ...base, engineVersion: 'development', kind: 'collab.participants' };
    for (const event of [openedSent, { ...participants, count: 2 }]) {
      const [checked] = validateTelemetryEvents([{ ...event, repeated: 3 }]);
      expect(checked).not.toHaveProperty('repeated');
      expect(toLogRecord(checked!).occurrences).toBe(1);
    }
  });

  test('numbers stay in range, whole where the engine counts, and on their own kind', () => {
    const kept = (event: object) => validateTelemetryEvents([event]).length === 1;
    /** The event is kept, without the field it does not carry. */
    const removed = (event: object, field: string) => {
      const events = validateTelemetryEvents([event]);
      return events.length === 1 && !(field in events[0]!);
    };
    const skipped = {
      ...base,
      engineVersion: 'development',
      kind: 'review.skipped',
      code: 'review.stale-revision',
      count: 2,
    };
    expect(kept(skipped)).toBe(true);
    expect(kept(openedSent)).toBe(true);
    for (const count of [-1, 1.5, 1_000_001]) expect(kept({ ...skipped, count })).toBe(false);
    expect(kept({ ...openedSent, durationMs: -1 })).toBe(false);
    for (const time of [-1, 9e15]) expect(kept({ ...sent, time })).toBe(false);
    for (const schemaVersion of [0, 1.5]) expect(kept({ ...sent, schemaVersion })).toBe(false);
    // A rejected open reports no open time; only a `ready` after a wait reports a join time.
    expect(
      kept({ ...sent, kind: 'document.open', outcome: 'rejected', code: 'open.xml-malformed' })
    ).toBe(true);
    expect(
      removed(
        {
          ...sent,
          kind: 'document.open',
          outcome: 'rejected',
          code: 'open.xml-malformed',
          durationMs: 2_000_000_000,
        },
        'durationMs'
      )
    ).toBe(true);
    const status = {
      ...base,
      engineVersion: 'development',
      kind: 'collab.status',
      previous: 'initializing',
      recovering: false,
    };
    expect(kept({ ...status, status: 'ready', connectMs: 800 })).toBe(true);
    expect(removed({ ...status, status: 'disconnected', connectMs: 800 }, 'connectMs')).toBe(true);
    // A summary of `ready` does not repeat the join time of the first one.
    expect(removed({ ...status, status: 'ready', connectMs: 800, repeated: 1 }, 'connectMs')).toBe(
      true
    );
    // A code belongs to its own kind's family.
    expect(kept({ ...sent, kind: 'font.failed', code: 'edit.picture-selected' })).toBe(false);
    expect(kept({ ...status, status: 'error', code: 'edit.read-only' })).toBe(false);
    // A join after a month offline keeps its event, without the span.
    expect(
      removed({ ...status, status: 'ready', connectMs: 31 * 24 * 3600 * 1000 }, 'connectMs')
    ).toBe(true);
    // The range still applies where the field belongs.
    expect(kept({ ...status, status: 'ready', connectMs: -1 })).toBe(false);
    // A field no event carries is removed, not trusted.
    const [stripped] = validateTelemetryEvents([{ ...sent, participants: 999_999 }]);
    expect(stripped).not.toHaveProperty('participants');
    // A field of another kind of event is removed, so a newer engine's field keeps its event.
    expect(removed({ ...sent, durationMs: 120 }, 'durationMs')).toBe(true);
    expect(removed({ ...sent, count: 2 }, 'count')).toBe(true);
    expect(removed({ ...openedSent, windowMs: 60_000 }, 'windowMs')).toBe(true);
  });

  test('a timing summary must add up: whole counts, bands that sum to count, ordered times', () => {
    const timing = {
      count: 8,
      p50Ms: 20,
      p95Ms: 240,
      maxMs: 1800,
      bands: [3, 2, 1, 0, 0, 1, 0, 1],
    };
    const performance = {
      ...base,
      engineVersion: 'development',
      kind: 'performance',
      windowMs: 60_000,
      interaction: timing,
    };
    const kept = (interaction: object) =>
      validateTelemetryEvents([{ ...performance, interaction }]).length === 1;
    expect(kept(timing)).toBe(true);
    expect(kept({ ...timing, count: 9 })).toBe(false);
    expect(kept({ ...timing, count: 0, bands: [0, 0, 0, 0, 0, 0, 0, 0] })).toBe(false);
    expect(kept({ ...timing, bands: [3, 2, 1, 0, 0, 1, 0.5, 0.5] })).toBe(false);
    expect(kept({ ...timing, bands: [3, 2, 1, 0, 0, 1, -1, 2] })).toBe(false);
    expect(kept({ ...timing, p50Ms: 300 })).toBe(false);
    expect(kept({ ...timing, p95Ms: 2000 })).toBe(false);
    expect(kept({ ...timing, maxMs: 31 * 24 * 60 * 60 * 1000 })).toBe(false);
    expect(kept([1, 2, 3, 4, 5, 6, 7, 8])).toBe(false);
    // The engine sends a summary only after it timed something.
    const { interaction: _interaction, ...untimed } = performance;
    expect(validateTelemetryEvents([untimed])).toEqual([]);
    expect(validateTelemetryEvents([{ ...untimed, paint: timing }])).toHaveLength(1);
    // A timing summary on another kind of event is removed.
    const [refused] = validateTelemetryEvents([{ ...sent, interaction: timing }]);
    expect(refused).toBeDefined();
    expect(refused).not.toHaveProperty('interaction');
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
