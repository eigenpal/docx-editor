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
  test('refuses on Global Privacy Control, Do Not Track, or the opt-out key', () => {
    const navigatorBefore = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const storageBefore = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const store = new Map<string, string>();
    const set = (signals: Record<string, unknown>) =>
      Object.defineProperty(globalThis, 'navigator', { value: signals, configurable: true });
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: (key: string) => store.get(key) ?? null },
      configurable: true,
    });
    try {
      const consent = browserPrivacySignals({ optOutKey: 'app:telemetry' });
      set({});
      expect(consent()).toBe(true);
      set({ globalPrivacyControl: true });
      expect(consent()).toBe(false);
      set({ doNotTrack: '1' });
      expect(consent()).toBe(false);
      set({});
      store.set('app:telemetry', 'off');
      expect(consent()).toBe(false);
    } finally {
      if (navigatorBefore) Object.defineProperty(globalThis, 'navigator', navigatorBefore);
      else delete (globalThis as { navigator?: unknown }).navigator;
      if (storageBefore) Object.defineProperty(globalThis, 'localStorage', storageBefore);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('ingest', () => {
  const sent = {
    ...refusal,
    engineVersion: 'development',
    resource: { 'service.name': 'site', note: 'Confidential settlement terms' },
  };

  test('validation keeps known events and drops unknown kinds, text, and long lists', () => {
    const events = validateTelemetryEvents([
      sent,
      { ...base, kind: 'page.view', url: '/x' },
      { ...sent, code: 'edit.made-up' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      code: 'edit.picture-selected',
      resource: { 'service.name': 'site' },
    });
    expect(JSON.stringify(events)).not.toContain('Confidential');
    expect(validateTelemetryEvents({ events: [sent] })).toEqual([]);
    expect(validateTelemetryEvents(Array.from({ length: 51 }, () => sent))).toEqual([]);
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

  test('the route forwards checked events and always answers 204', async () => {
    const forwarded: unknown[] = [];
    const errors: unknown[] = [];
    const route = telemetryRoute({
      forward: (events) => {
        forwarded.push(...events);
        return new Response(null, { status: forwarded.length > 1 ? 403 : 202 });
      },
      allowedOrigins: ['https://app.example.com'],
      onError: (error) => errors.push(error),
    });
    // A browser request carries Origin; a script cannot set it on `new Request`, so this stands in.
    const post = (body: unknown, origin = 'https://app.example.com') =>
      route({
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json', origin }),
        text: async () => JSON.stringify(body),
      } as unknown as Request);
    expect((await post([sent])).status).toBe(204);
    expect(forwarded).toHaveLength(1);
    expect((await post([sent], 'https://evil.example')).status).toBe(204);
    expect((await post('not json')).status).toBe(204);
    expect(forwarded).toHaveLength(1);
    // The log service refused: the route still answers 204 and reports it.
    expect((await post([sent])).status).toBe(204);
    expect(errors).toHaveLength(1);
    expect((await route(new Request('https://app.example.com/', { method: 'GET' }))).status).toBe(
      405
    );
  });
});
