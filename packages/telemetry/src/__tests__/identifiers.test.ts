/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Your identifiers: client attributes, per-editor attributes from `moduleFor`, and the few keys
// you allow as metric labels. Events carry every identifier; metrics stay bounded.
import { describe, expect, test } from 'bun:test';
import { trace } from '@opentelemetry/api';
import type { EditorDiagnostic } from '@docx-editor.dev/core';
import { createTelemetry, MAX_METRIC_LABEL_VALUES, memoryExporter, METRICS } from '../index.ts';
import { otelExporter } from '../otel/index.ts';
import { sentryExporter, type SentryLike } from '../sentry/index.ts';

const base = { schemaVersion: 1, editorSessionId: 'e_0123456789abcdef', time: 1_700_000_000_000 };
const refusal = (editorSessionId = base.editorSessionId): EditorDiagnostic =>
  ({
    ...base,
    editorSessionId,
    kind: 'edit.rejected',
    code: 'edit.read-only',
    origin: 'input',
    tracked: false,
  }) as EditorDiagnostic;

describe('identifiers on events', () => {
  test('each editor module adds its own values to its own events, after the client values', () => {
    const memory = memoryExporter();
    let tenant = 'tenant-a';
    const telemetry = createTelemetry({
      exporters: [memory],
      dedupeWindowMs: 0,
      attributes: () => ({ 'tenant.id': tenant, 'user.id': 'u-17' }),
    });
    const roomOne = telemetry.moduleFor({ 'room.id': 'room-1', 'user.id': 'u-17-in-room' });
    const roomTwo = telemetry.moduleFor({ 'room.id': 'room-2' });
    roomOne.onDiagnostic!(refusal('e_0000000000000001'));
    tenant = 'tenant-b';
    roomTwo.onDiagnostic!(refusal('e_0000000000000002'));
    telemetry.module.onDiagnostic!(refusal('e_0000000000000003'));
    expect(memory.events.map((event) => event.attributes)).toEqual([
      { 'tenant.id': 'tenant-a', 'user.id': 'u-17-in-room', 'room.id': 'room-1' },
      { 'tenant.id': 'tenant-b', 'user.id': 'u-17', 'room.id': 'room-2' },
      { 'tenant.id': 'tenant-b', 'user.id': 'u-17' },
    ]);
  });

  test('bad keys are dropped, and a throwing attributes function adds nothing', () => {
    const memory = memoryExporter();
    const quiet = createTelemetry({
      exporters: [memory],
      dedupeWindowMs: 0,
      attributes: () => {
        throw new Error('session not ready');
      },
    });
    quiet.moduleFor({ 'room.id': 'room-1', 'not a key!': 'x' }).onDiagnostic!(refusal());
    expect(memory.events[0]!.attributes).toEqual({ 'room.id': 'room-1' });
  });

  test('a summary of repeated refusals keeps the values of its first event', async () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory], dedupeWindowMs: 60_000 });
    const room = telemetry.moduleFor({ 'room.id': 'room-1' });
    room.onDiagnostic!(refusal());
    room.onDiagnostic!(refusal());
    await telemetry.flush();
    expect(memory.events.map((event) => [event.repeated, event.attributes['room.id']])).toEqual([
      [undefined, 'room-1'],
      [1, 'room-1'],
    ]);
  });
});

describe('identifiers on metrics', () => {
  test('only keys in metricLabels label metrics', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({
      exporters: [memory],
      attributes: { 'tenant.tier': 'enterprise', 'user.id': 'u-17' },
      metricLabels: ['tenant.tier'],
    });
    telemetry.moduleFor({ 'room.id': 'room-1' }).onDiagnostic!(refusal());
    const rejection = memory.metrics.find((record) => record.definition === METRICS.editRejections);
    expect(rejection?.attributes).toEqual({
      code: 'edit.read-only',
      cause: 'none',
      origin: 'input',
      tracked: false,
      'tenant.tier': 'enterprise',
      'docx_editor.version': 'development',
    });
  });

  test('a label with too many distinct values turns later values into other', () => {
    const memory = memoryExporter();
    let tier = 0;
    const telemetry = createTelemetry({
      exporters: [memory],
      dedupeWindowMs: 0,
      attributes: () => ({ 'tenant.tier': `tier-${tier}` }),
      metricLabels: ['tenant.tier'],
    });
    for (tier = 0; tier < MAX_METRIC_LABEL_VALUES + 5; tier += 1) telemetry.record(refusal());
    const values = new Set(
      memory.metrics
        .filter((record) => record.definition === METRICS.editRejections)
        .map((record) => record.attributes['tenant.tier'])
    );
    expect(values.size).toBe(MAX_METRIC_LABEL_VALUES + 1);
    expect(values.has('other')).toBe(true);
    // Events keep the real value.
    expect(memory.events.at(-1)!.attributes['tenant.tier']).toBe(
      `tier-${MAX_METRIC_LABEL_VALUES + 4}`
    );
  });
});

describe('identifiers in exporters', () => {
  test('Sentry issues carry them as tags', () => {
    const contexts: { tags?: Record<string, string> }[] = [];
    const sentry: SentryLike = {
      captureException: (_error, context) => void contexts.push(context as never),
      addBreadcrumb: () => {},
    };
    const telemetry = createTelemetry({ exporters: [sentryExporter(sentry)] });
    telemetry.moduleFor({ 'room.id': 'room-1', 'user.id': 'u-17' }).onDiagnostic!({
      ...base,
      kind: 'document.open',
      outcome: 'rejected',
      code: 'open.unsupported-source',
    } as EditorDiagnostic);
    expect(contexts[0]?.tags).toMatchObject({ 'room.id': 'room-1', 'user.id': 'u-17' });
  });

  test('OpenTelemetry span events carry them under their own keys', () => {
    const recorded: Record<string, unknown>[] = [];
    const exporter = otelExporter({
      meterProvider: {
        getMeter: () => ({
          createCounter: () => ({ add: () => {} }),
          createHistogram: () => ({ record: () => {} }),
          createGauge: () => ({ record: () => {} }),
        }),
      } as never,
      tracerProvider: { getTracer: () => ({}) } as never,
    });
    const active = trace.getActiveSpan;
    trace.getActiveSpan = () =>
      ({
        addEvent: (_: string, values: Record<string, unknown>) => recorded.push(values),
      }) as never;
    try {
      createTelemetry({ exporters: [exporter] }).moduleFor({ 'room.id': 'room-1' }).onDiagnostic!(
        refusal()
      );
    } finally {
      trace.getActiveSpan = active;
    }
    expect(recorded[0]).toMatchObject({ 'room.id': 'room-1', 'docx_editor.kind': 'edit.rejected' });
    expect(Object.keys(recorded[0]!).some((key) => key.includes('attributes'))).toBe(false);
  });
});

test('dropped events carry your metric labels, so filtered dashboards still show them', () => {
  const memory = memoryExporter();
  const telemetry = createTelemetry({
    exporters: [memory],
    attributes: { 'deployment.environment': 'production' },
    metricLabels: ['deployment.environment'],
  });
  telemetry.record({ ...refusal(), code: 'edit.from-a-newer-core' } as never);
  const dropped = memory.metrics.find((record) => record.definition === METRICS.droppedEvents);
  expect(dropped?.attributes).toMatchObject({
    reason: 'unknown-code',
    'deployment.environment': 'production',
  });
});
