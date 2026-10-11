/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import type { EditorDiagnostic } from '@docx-editor.dev/core';
import { createTelemetry, METRICS } from '../index.ts';
import { otelExporter } from '../otel/index.ts';
import { fetchMetricsHandler, metricsHandler, prometheusRegistry } from '../prometheus/index.ts';
import { DocxEditorDiagnosticError, sentryExporter, type SentryLike } from '../sentry/index.ts';

const base = { schemaVersion: 1, editorSessionId: 'e_0123456789abcdef', time: 1_700_000_000_000 };
const openRejected = {
  ...base,
  kind: 'document.open',
  outcome: 'rejected',
  code: 'open.zip-ratio-limit',
  sizeBucket: '4-8MiB',
} as EditorDiagnostic;
const opened = {
  ...base,
  kind: 'document.open',
  outcome: 'opened',
  sizeBucket: '0-64KiB',
  pagesBucket: '2-9',
  durationMs: 120,
} as EditorDiagnostic;
const refusal = {
  ...base,
  kind: 'edit.rejected',
  code: 'edit.protected-content',
  origin: 'input',
  tracked: false,
} as EditorDiagnostic;

describe('sentryExporter', () => {
  function fakeSentry() {
    const issues: { error: unknown; context: unknown }[] = [];
    const crumbs: unknown[] = [];
    const sentry: SentryLike = {
      captureException: (error, context) => issues.push({ error, context }),
      addBreadcrumb: (crumb) => void crumbs.push(crumb),
    };
    return { sentry, issues, crumbs };
  }

  test('a refused open is an issue grouped by code; a refused edit is a breadcrumb', () => {
    const { sentry, issues, crumbs } = fakeSentry();
    const telemetry = createTelemetry({ exporters: [sentryExporter(sentry)] });
    telemetry.record(openRejected);
    telemetry.record(refusal);

    expect(issues).toHaveLength(1);
    const [{ error, context }] = issues;
    expect(error).toBeInstanceOf(DocxEditorDiagnosticError);
    expect((error as Error).message).toStartWith('open.zip-ratio-limit: ');
    expect(context).toMatchObject({
      fingerprint: ['docx-editor', 'document.open', 'open.zip-ratio-limit'],
      level: 'error',
      tags: { 'docx_editor.code': 'open.zip-ratio-limit', 'docx_editor.outcome': 'rejected' },
    });
    expect(crumbs).toEqual([
      expect.objectContaining({
        category: 'docx-editor',
        message: 'edit refused: edit.protected-content (input, untracked)',
      }),
    ]);
  });
});

describe('sentryExporter summaries', () => {
  test('a deduplication summary never becomes a second issue', async () => {
    const issues: unknown[] = [];
    const crumbs: unknown[] = [];
    const telemetry = createTelemetry({
      exporters: [
        sentryExporter({
          captureException: (error) => issues.push(error),
          addBreadcrumb: (crumb) => void crumbs.push(crumb),
        }),
      ],
    });
    const invariant = { ...refusal, code: 'edit.internal-invariant' } as EditorDiagnostic;
    telemetry.record(invariant);
    telemetry.record(invariant);
    await telemetry.flush();
    expect(issues).toHaveLength(1);
    expect(crumbs).toHaveLength(1);
  });
});

describe('otelExporter', () => {
  test('records metrics on instruments and a span for each open', () => {
    const recorded: [string, string, number][] = [];
    const spans: {
      name: string;
      options: { startTime?: number };
      ended?: number;
      status?: unknown;
    }[] = [];
    const meter = {
      createCounter: (name: string) => ({
        add: (value: number) => void recorded.push(['counter', name, value]),
      }),
      createHistogram: (name: string) => ({
        record: (value: number) => void recorded.push(['histogram', name, value]),
      }),
      createGauge: (name: string) => ({
        record: (value: number) => void recorded.push(['gauge', name, value]),
      }),
    };
    const tracer = {
      startSpan(name: string, options: { startTime?: number }) {
        const span = { name, options } as (typeof spans)[number];
        spans.push(span);
        return {
          setStatus: (status: unknown) => void (span.status = status),
          end: (time: number) => void (span.ended = time),
        };
      },
    };
    const exporter = otelExporter({
      meterProvider: { getMeter: () => meter } as never,
      tracerProvider: { getTracer: () => tracer } as never,
    });
    const telemetry = createTelemetry({ exporters: [exporter] });
    telemetry.record(opened);
    telemetry.record(openRejected);

    expect(recorded).toContainEqual(['counter', METRICS.documentOpens.name, 1]);
    expect(recorded).toContainEqual(['histogram', METRICS.documentOpenDuration.name, 0.12]);
    expect(spans.map((span) => span.name)).toEqual([
      'docx_editor.document.open',
      'docx_editor.document.open',
    ]);
    expect(spans[0]).toMatchObject({ options: { startTime: base.time - 120 }, ended: base.time });
    expect(spans[1]!.status).toMatchObject({ message: 'open.zip-ratio-limit' });
  });
});

describe('prometheus', () => {
  test('renders counters and histograms in the text format', () => {
    const metrics = prometheusRegistry();
    const telemetry = createTelemetry({ exporters: [metrics], dedupeWindowMs: 0 });
    telemetry.record(opened);
    telemetry.record(refusal);
    telemetry.record(refusal);
    const text = metrics.metrics();
    expect(text).toContain('# TYPE docx_editor_edit_rejections_total counter');
    expect(text).toContain(
      'docx_editor_edit_rejections_total{code="edit.protected-content",origin="input",tracked="false"} 2'
    );
    expect(text).toContain('# TYPE docx_editor_document_open_duration_seconds histogram');
    expect(text).toContain('docx_editor_document_open_duration_seconds_bucket{le="0.25"} 1');
    expect(text).toContain('docx_editor_document_open_duration_seconds_bucket{le="0.1"} 0');
    expect(text).toContain('docx_editor_document_open_duration_seconds_count 1');
  });

  test('the handler serves Fetch and Node style, and merges another registry', async () => {
    const metrics = prometheusRegistry();
    metrics.metric!({ definition: METRICS.roomsActive, value: 3, attributes: {} });
    const merge = [{ metrics: async () => '# from prom-client\nprocess_up 1\n' }];

    const response = await fetchMetricsHandler(metrics, { merge })(
      new Request('http://localhost/metrics')
    );
    expect(response.headers.get('content-type')).toStartWith('text/plain; version=0.0.4');
    const body = await response.text();
    expect(body).toContain('docx_editor_collab_rooms_active 3');
    expect(body).toContain('process_up 1');

    const written: { headers: Record<string, string>; body?: string } = { headers: {} };
    await metricsHandler(metrics, { merge })(
      {},
      {
        setHeader: (name, value) => void (written.headers[name] = value),
        end: (text) => void (written.body = text),
      }
    );
    expect(written.body).toContain('docx_editor_collab_rooms_active 3');
  });
});
