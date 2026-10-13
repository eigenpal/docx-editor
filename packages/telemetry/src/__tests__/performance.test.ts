/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The performance area end to end: a real editor's summary reaches every exporter as an event
// and as histograms whose bucket counts match the summary exactly, with no document content.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { trace } from '@opentelemetry/api';
import {
  createDocxEditor,
  type EditorDiagnostic,
  type PerformanceDiagnostic,
} from '@docx-editor.dev/core';
import { consoleExporter, createTelemetry, memoryExporter, METRICS } from '../index.ts';
import { otelExporter } from '../otel/index.ts';
import { prometheusRegistry } from '../prometheus/index.ts';
import { sentryExporter, type SentryLike } from '../sentry/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SECRET = 'Draft acquisition terms';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${SECRET}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

const base = { schemaVersion: 1, editorSessionId: 'e_0123456789abcdef', time: 1_700_000_000_000 };
const timing = (bands: number[], maxMs: number) => ({
  count: bands.reduce((sum, count) => sum + count, 0),
  p50Ms: 20,
  p95Ms: 240,
  maxMs,
  bands,
});
const summary = (fields: Partial<PerformanceDiagnostic> = {}): EditorDiagnostic =>
  ({
    ...base,
    kind: 'performance',
    windowMs: 60_000,
    pagesBucket: '10-99',
    interaction: timing([3, 2, 1, 0, 0, 1, 0, 1], 1800),
    ...fields,
  }) as EditorDiagnostic;

/** Bucket counts of one histogram in the Prometheus text, by upper bound. */
function buckets(text: string, name: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const match of text.matchAll(
    new RegExp(
      `^${name}_bucket\\{docx_editor_version="development",pages="10-99",le="([^"]+)"\\} (\\d+)$`,
      'gm'
    )
  ))
    out[match[1]!] = Number(match[2]);
  return out;
}

describe('performance with a real editor', () => {
  test('a press and an edit reach the event and the metrics, without content', async () => {
    const memory = memoryExporter();
    const metrics = prometheusRegistry();
    const telemetry = createTelemetry({
      exporters: [memory, metrics],
      include: { performance: true },
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const editor = createDocxEditor({ container, document: docx(), modules: [telemetry.module] });
    try {
      container
        .querySelector('[contenteditable="true"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(editor.exec({ type: 'insertText', text: 'y' }).ok).toBe(true);
    } finally {
      editor.destroy();
      container.remove();
    }
    await telemetry.flush();

    const events = memory.events.filter((event) => event.kind === 'performance');
    expect(events).toHaveLength(1);
    const event = events[0] as PerformanceDiagnostic;
    expect(event.interaction?.count).toBe(1);
    const text = metrics.metrics();
    expect(text).toContain(
      'docx_editor_editor_interaction_duration_seconds_count{docx_editor_version="development",pages="1"} 1'
    );
    expect(text).toContain(
      `docx_editor_editor_layout_duration_seconds_count{docx_editor_version="development",pages="1"} ${event.layout!.count}`
    );
    expect(text).toContain(
      `docx_editor_editor_paint_duration_seconds_count{docx_editor_version="development",pages="1"} ${event.paint!.count}`
    );
    expect(JSON.stringify(memory.events) + text).not.toContain(SECRET.split(' ')[1]);
    await telemetry.shutdown();
  });
});

describe('performance summaries', () => {
  test('histogram buckets match the summary bands exactly', () => {
    const metrics = prometheusRegistry();
    const telemetry = createTelemetry({ exporters: [metrics] });
    telemetry.record(summary());
    expect(buckets(metrics.metrics(), 'docx_editor_editor_interaction_duration_seconds')).toEqual({
      '0.016': 3,
      '0.033': 5,
      '0.05': 6,
      '0.1': 6,
      '0.2': 6,
      '0.5': 7,
      '1': 7,
      '+Inf': 8,
    });
  });

  test('the area is off unless included, and metrics count it even when events are sampled out', () => {
    const memory = memoryExporter();
    createTelemetry({ exporters: [memory], include: { editing: true } }).record(summary());
    expect(memory.events).toEqual([]);
    expect(memory.metrics).toEqual([]);

    // A rate above 0 samples the event out almost always; its metrics still count.
    createTelemetry({ exporters: [memory], include: { performance: { sampleRate: 1e-9 } } }).record(
      summary()
    );
    expect(memory.events).toEqual([]);
    expect(
      memory.metrics.filter((r) => r.definition === METRICS.editorInteractionDuration)
    ).toHaveLength(8);
  });

  test('a malformed timing summary is dropped whole and counted', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    const bad = [
      { ...timing([1, 0, 0, 0, 0, 0, 0, 0], 5), note: 'typed text' },
      { ...timing([1, 0, 0], 5) },
      { ...timing([1, 0, 0, 0, 0, 0, 0, 0], -1) },
    ];
    for (const interaction of bad)
      telemetry.record(summary({ interaction } as unknown as Partial<PerformanceDiagnostic>));
    expect(memory.events).toEqual([]);
    expect(
      memory.metrics.filter((r) => r.definition === METRICS.droppedEvents).map((r) => r.attributes)
    ).toEqual([
      { reason: 'invalid-field', 'docx_editor.version': 'development' },
      { reason: 'invalid-field', 'docx_editor.version': 'development' },
      { reason: 'invalid-field', 'docx_editor.version': 'development' },
    ]);
  });

  test('the console prints one line, and a warning with the hint when presses are slow', () => {
    const lines: [string, string][] = [];
    const console = {
      info: (line: string) => void lines.push(['info', line]),
      warn: (line: string) => void lines.push(['warn', line]),
    };
    const telemetry = createTelemetry({ exporters: [consoleExporter({ console })] });
    telemetry.record(summary());
    telemetry.record(summary({ code: 'performance.slow-interaction' }));
    expect(lines[0]).toEqual([
      'info',
      '[docx-editor] performance over 60 s, 10-99 pages: key presses and clicks p50 20 ms, p95 240 ms, max 1800 ms (x8)',
    ]);
    expect(lines[1]![0]).toBe('warn');
    expect(lines[1]![1]).toContain('took over 200 ms to reach the screen');
    expect(lines[1]![1]).toContain('#performance-slow-interaction');
  });

  test('Sentry gets a breadcrumb, never an issue', () => {
    const issues: unknown[] = [];
    const crumbs: { level?: string }[] = [];
    const sentry: SentryLike = {
      captureException: (error) => void issues.push(error),
      addBreadcrumb: (crumb) => void crumbs.push(crumb),
    };
    const telemetry = createTelemetry({ exporters: [sentryExporter(sentry)] });
    telemetry.record(summary());
    telemetry.record(summary({ code: 'performance.slow-interaction' }));
    expect(issues).toEqual([]);
    expect(crumbs.map((crumb) => crumb.level)).toEqual(['info', 'warning']);
  });

  test('OpenTelemetry gets histograms and flat span attributes', () => {
    const recorded: [string, number][] = [];
    const attributes: Record<string, unknown>[] = [];
    const meter = {
      createCounter: () => ({ add: () => {} }),
      createHistogram: (name: string) => ({
        record: (value: number) => void recorded.push([name, value]),
      }),
      createGauge: () => ({ record: () => {} }),
    };
    const span = {
      addEvent: (_: string, values: Record<string, unknown>) => attributes.push(values),
    };
    const exporter = otelExporter({
      meterProvider: { getMeter: () => meter } as never,
      tracerProvider: { getTracer: () => ({}) } as never,
    });
    const active = trace.getActiveSpan;
    trace.getActiveSpan = () => span as never;
    try {
      createTelemetry({ exporters: [exporter] }).record(summary());
    } finally {
      trace.getActiveSpan = active;
    }
    expect(
      recorded.filter(([name]) => name === METRICS.editorInteractionDuration.name)
    ).toHaveLength(8);
    expect(attributes[0]).toMatchObject({
      'docx_editor.kind': 'performance',
      'docx_editor.interaction.p95Ms': 240,
      'docx_editor.interaction.count': 8,
    });
    expect(Object.keys(attributes[0]!).some((key) => key.includes('bands'))).toBe(false);
  });
});

test('hiding the page flushes the exporters after the editor sends its summary', async () => {
  const order: string[] = [];
  const telemetry = createTelemetry({
    exporters: [
      {
        name: 'order',
        event: (event) => void order.push(event.kind),
        flush: () => void order.push('flush'),
      },
    ],
    include: { performance: true, documentOpen: true },
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({ container, document: docx(), modules: [telemetry.module] });
  try {
    editor.exec({ type: 'insertText', text: 'z' });
    order.length = 0;
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true }));
    await Promise.resolve();
    expect(order).toEqual(['performance', 'flush']);
  } finally {
    // An own property shadows the prototype's getter; deleting it leaves `document` as found.
    delete (document as { visibilityState?: unknown }).visibilityState;
    editor.destroy();
    container.remove();
    await telemetry.shutdown();
  }
});

test('shutdown removes the page listeners', async () => {
  let flushes = 0;
  const telemetry = createTelemetry({
    exporters: [{ name: 'count', event: () => {}, flush: () => void (flushes += 1) }],
  });
  telemetry.record(summary());
  await telemetry.shutdown();
  flushes = 0;
  globalThis.dispatchEvent(new Event('pagehide'));
  await Promise.resolve();
  expect(flushes).toBe(0);
});

test('performance is sampled once per editor: all of its summaries or none', () => {
  const memory = memoryExporter();
  const telemetry = createTelemetry({
    exporters: [memory],
    include: { performance: { sampleRate: 0.5 } },
  });
  const editors = Array.from({ length: 40 }, (_, index) => `e_${String(index).padStart(16, '0')}`);
  for (let round = 0; round < 5; round += 1)
    for (const editorSessionId of editors)
      telemetry.record({ ...summary(), editorSessionId } as EditorDiagnostic);
  const perEditor = new Map<string, number>();
  for (const event of memory.events)
    perEditor.set(event.editorSessionId, (perEditor.get(event.editorSessionId) ?? 0) + 1);
  expect([...perEditor.values()].every((count) => count === 5)).toBe(true);
  expect(perEditor.size).toBeGreaterThan(0);
  expect(perEditor.size).toBeLessThan(40);
});

test('a press just over the last bound lands in the overflow bucket', () => {
  const metrics = prometheusRegistry();
  createTelemetry({ exporters: [metrics] }).record(
    summary({ interaction: timing([0, 0, 0, 0, 0, 0, 0, 1], 1000) })
  );
  expect(
    buckets(metrics.metrics(), 'docx_editor_editor_interaction_duration_seconds')
  ).toMatchObject({
    '1': 0,
    '+Inf': 1,
  });
});

test('the module wants performance only with the area on and consent given', async () => {
  let consent = false;
  const on = createTelemetry({
    exporters: [memoryExporter()],
    include: { performance: true },
    consent: () => consent,
  });
  const off = createTelemetry({ exporters: [memoryExporter()], include: { editing: true } });
  expect(on.module.wantsDiagnostic?.('performance')).toBe(false);
  consent = true;
  expect(on.module.wantsDiagnostic?.('performance')).toBe(true);
  expect(off.module.wantsDiagnostic?.('performance')).toBe(false);
  expect(off.module.wantsDiagnostic?.('edit.rejected')).toBe(true);
  await on.shutdown();
  expect(on.module.wantsDiagnostic?.('performance')).toBe(false);
});

test('a sample rate of 0 turns performance measuring off', () => {
  const telemetry = createTelemetry({
    exporters: [memoryExporter()],
    include: { performance: { sampleRate: 0 } },
  });
  expect(telemetry.module.wantsDiagnostic?.('performance')).toBe(false);
  // Another listener can keep the editor measuring; the summary still records nothing.
  const memory = memoryExporter();
  createTelemetry({ exporters: [memory], include: { performance: { sampleRate: 0 } } }).record(
    summary()
  );
  expect(memory.metrics).toEqual([]);
});

test('Sentry issues carry the editor session tag for correlation', () => {
  const contexts: { tags?: Record<string, string> }[] = [];
  const sentry: SentryLike = {
    captureException: (_error, context) => void contexts.push(context as never),
    addBreadcrumb: () => {},
  };
  createTelemetry({ exporters: [sentryExporter(sentry)] }).record({
    ...base,
    kind: 'document.open',
    outcome: 'rejected',
    code: 'open.unsupported-source',
  } as EditorDiagnostic);
  expect(contexts[0]?.tags?.['docx_editor.editor_session']).toBe(base.editorSessionId);
});
