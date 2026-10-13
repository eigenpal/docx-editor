/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import type { EditorDiagnostic } from '@docx-editor.dev/core';
import { createTelemetry, METRICS, prometheusName } from '../index.ts';
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

  test('an open the app caused is an issue grouped by code; a bad file and an edit are breadcrumbs', () => {
    const { sentry, issues, crumbs } = fakeSentry();
    const telemetry = createTelemetry({ exporters: [sentryExporter(sentry)] });
    telemetry.record({ ...openRejected, code: 'open.unsupported-source' } as EditorDiagnostic);
    telemetry.record(openRejected);
    telemetry.record(refusal);

    expect(issues).toHaveLength(1);
    const [{ error, context }] = issues;
    expect(error).toBeInstanceOf(DocxEditorDiagnosticError);
    expect((error as Error).message).toStartWith('open.unsupported-source: ');
    expect(context).toMatchObject({
      fingerprint: ['docx-editor', 'document.open', 'open.unsupported-source'],
      level: 'error',
      tags: { 'docx_editor.code': 'open.unsupported-source', 'docx_editor.outcome': 'rejected' },
    });
    expect(crumbs).toEqual([
      expect.objectContaining({ message: 'document refused: open.zip-ratio-limit' }),
      expect.objectContaining({
        category: 'docx-editor',
        message: 'edit refused: edit.protected-content (input, untracked)',
      }),
    ]);
  });

  test('a change the engine cannot resolve is an issue per kind; a stale one is a breadcrumb', () => {
    const { sentry, issues, crumbs } = fakeSentry();
    const telemetry = createTelemetry({ exporters: [sentryExporter(sentry)] });
    const skipped = {
      ...base,
      kind: 'review.skipped',
      code: 'review.revision-unsupported',
      count: 2,
      operation: 'accept',
      changeKind: 'format',
      formattingKind: 'rPrChange',
      part: 'footnotes',
    } as EditorDiagnostic;
    telemetry.record(skipped);
    telemetry.record({ ...skipped, code: 'review.stale-revision', count: 1 } as EditorDiagnostic);

    expect(issues).toHaveLength(1);
    expect(issues[0]!.context).toMatchObject({
      fingerprint: [
        'docx-editor',
        'review.skipped',
        'review.revision-unsupported',
        'format',
        'rPrChange',
      ],
      level: 'warning',
      tags: {
        'docx_editor.operation': 'accept',
        'docx_editor.change_kind': 'format',
        'docx_editor.formatting_kind': 'rPrChange',
        'docx_editor.part': 'footnotes',
      },
    });
    expect(crumbs).toEqual([
      expect.objectContaining({
        message:
          'tracked changes skipped: review.stale-revision [accept, format, rPrChange, footnotes] x1',
      }),
    ]);
  });

  test('the engine reason splits one code into separate issues', () => {
    const { sentry, issues } = fakeSentry();
    const telemetry = createTelemetry({ exporters: [sentryExporter(sentry)] });
    const crash = {
      ...base,
      kind: 'edit.rejected',
      code: 'edit.internal-invariant',
      origin: 'command',
      tracked: true,
      command: 'acceptRevision',
      cause: 'exception',
      errorName: 'TypeError',
    } as EditorDiagnostic;
    telemetry.record(crash);
    const { errorName: _errorName, ...invariant } = crash as EditorDiagnostic & {
      errorName?: string;
    };
    telemetry.record({ ...invariant, cause: 'tree-invariant' } as EditorDiagnostic);
    expect(issues.map((issue) => (issue.context as { fingerprint: string[] }).fingerprint)).toEqual(
      [
        ['docx-editor', 'edit.rejected', 'edit.internal-invariant', 'exception', 'TypeError'],
        ['docx-editor', 'edit.rejected', 'edit.internal-invariant', 'tree-invariant'],
      ]
    );
    expect(issues[0]!.context).toMatchObject({
      tags: { 'docx_editor.cause': 'exception', 'docx_editor.error_name': 'TypeError' },
    });
  });
});

describe('deduplication keeps distinct failures apart', () => {
  test('two exception classes in one window are two events', () => {
    const seen: string[] = [];
    const telemetry = createTelemetry({
      exporters: [
        {
          name: 'memory',
          event: (event) => {
            const fields = event as unknown as Record<string, unknown>;
            seen.push(`${String(fields.errorName)}:${String(fields.repeated ?? 0)}`);
          },
        },
      ],
    });
    const crash = {
      ...base,
      kind: 'edit.rejected',
      code: 'edit.internal-invariant',
      origin: 'command',
      tracked: false,
      cause: 'exception',
      stage: 'command',
    };
    telemetry.record({ ...crash, errorName: 'TypeError' } as EditorDiagnostic);
    telemetry.record({ ...crash, errorName: 'RangeError' } as EditorDiagnostic);
    telemetry.record({ ...crash, errorName: 'TypeError' } as EditorDiagnostic);
    void telemetry.flush();
    expect(seen).toEqual(['TypeError:0', 'RangeError:0', 'TypeError:1']);
  });
});

describe('failure detail passes the privacy check only from closed lists', () => {
  test('known detail is kept; a value outside its list is dropped, never sent', () => {
    const memory = { events: [] as Record<string, unknown>[] };
    const telemetry = createTelemetry({
      exporters: [{ name: 'memory', event: (event) => void memory.events.push({ ...event }) }],
    });
    telemetry.record({
      ...openRejected,
      code: 'open.xml-malformed',
      cause: 'undeclared-prefix',
      part: 'header',
    } as EditorDiagnostic);
    telemetry.record({
      ...openRejected,
      code: 'open.xml-malformed',
      cause: 'word/client-matter-4471.xml',
      part: 'client-matter-4471',
      errorName: 'SecretError',
    } as unknown as EditorDiagnostic);
    expect(memory.events[0]).toMatchObject({ cause: 'undeclared-prefix', part: 'header' });
    expect(memory.events[1]).not.toHaveProperty('cause');
    expect(memory.events[1]).not.toHaveProperty('part');
    expect(memory.events[1]).not.toHaveProperty('errorName');
    expect(JSON.stringify(memory.events)).not.toContain('client-matter-4471');
  });
});

describe('sentryExporter collaboration defaults', () => {
  test('an expired token is a breadcrumb; a broken room is an issue', () => {
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
    const status = (code: string) =>
      ({
        ...base,
        kind: 'collab.status',
        status: 'error',
        previous: 'ready',
        code,
        recovering: false,
      }) as EditorDiagnostic;
    telemetry.record(status('collab.authentication-failed'));
    telemetry.record(status('collab.blob-digest-mismatch'));
    expect(issues).toHaveLength(1);
    expect(crumbs).toHaveLength(1);
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

describe('otelExporter gauges', () => {
  test('a forgotten series is no longer observed', () => {
    let callback:
      | ((result: { observe: (value: number, attributes: unknown) => void }) => void)
      | undefined;
    const meter = {
      createObservableGauge: () => ({ addCallback: (fn: typeof callback) => void (callback = fn) }),
    };
    const exporter = otelExporter({
      meterProvider: { getMeter: () => meter } as never,
      tracerProvider: { getTracer: () => ({}) } as never,
    });
    exporter.metric!({
      definition: METRICS.roomParticipantsByRoom,
      value: 3,
      attributes: { room: 'room-1' },
    });
    exporter.metric!({
      definition: METRICS.roomParticipantsByRoom,
      value: 1,
      attributes: { room: 'room-2' },
    });
    exporter.forget!(METRICS.roomParticipantsByRoom, { room: 'room-1' });
    const observed: unknown[] = [];
    callback!({ observe: (_value, attributes) => void observed.push(attributes) });
    expect(observed).toEqual([{ room: 'room-2' }]);
  });
});

describe('otelExporter without an active span', () => {
  test('a failure gets a short span of its own; a success does not', () => {
    const spans: string[] = [];
    const exporter = otelExporter({
      meterProvider: {
        getMeter: () => ({
          createCounter: () => ({ add: () => {} }),
          createHistogram: () => ({ record: () => {} }),
        }),
      } as never,
      tracerProvider: {
        getTracer: () => ({
          startSpan: (name: string) => {
            spans.push(name);
            return { setStatus: () => {}, end: () => {} };
          },
        }),
      } as never,
    });
    const telemetry = createTelemetry({ exporters: [exporter], dedupeWindowMs: 0 });
    telemetry.record({
      ...refusal,
      code: 'edit.tracked-drawing-delete-unsupported',
    } as EditorDiagnostic);
    // Expected refusals and summaries are not failures.
    telemetry.record(refusal);
    telemetry.record({ ...base, kind: 'history', code: 'history.split' } as EditorDiagnostic);
    expect(spans).toEqual(['docx_editor.edit.rejected']);
  });
});

describe('otelExporter with a late SDK', () => {
  test('measurements after the SDK registers reach it', async () => {
    const { metrics } = await import('@opentelemetry/api');
    const warn = console.warn;
    console.warn = () => {};
    const exporter = otelExporter();
    const telemetry = createTelemetry({ exporters: [exporter] });
    const added: string[] = [];
    try {
      telemetry.record(refusal);
      metrics.setGlobalMeterProvider({
        getMeter: () =>
          ({
            createCounter: (name: string) => ({ add: () => void added.push(name) }),
            createHistogram: () => ({ record: () => {} }),
            createGauge: () => ({ record: () => {} }),
          }) as never,
      });
      telemetry.record({ ...refusal, code: 'edit.read-only' } as EditorDiagnostic);
    } finally {
      console.warn = warn;
      metrics.disable();
    }
    expect(added).toEqual([METRICS.editRejections.name]);
  });
});

describe('prometheusName', () => {
  test('follows the OpenTelemetry Prometheus naming rules', () => {
    expect(prometheusName(METRICS.roomLoadDuration)).toBe(
      'docx_editor_collab_room_load_duration_seconds'
    );
    expect(prometheusName(METRICS.updateBytes)).toBe('docx_editor_collab_update_bytes_total');
    // `_ratio` is for gauges; a unit-1 histogram gets no unit suffix.
    expect(prometheusName(METRICS.roomResourceUsage)).toBe(
      'docx_editor_collab_room_resource_usage'
    );
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
      'docx_editor_edit_rejections_total{cause="none",code="edit.protected-content",docx_editor_version="development",origin="input",tracked="false"} 2'
    );
    expect(text).toContain('# TYPE docx_editor_document_open_duration_seconds histogram');
    expect(text).toContain(
      'docx_editor_document_open_duration_seconds_bucket{docx_editor_version="development",le="0.25"} 1'
    );
    expect(text).toContain(
      'docx_editor_document_open_duration_seconds_bucket{docx_editor_version="development",le="0.1"} 0'
    );
    expect(text).toContain(
      'docx_editor_document_open_duration_seconds_count{docx_editor_version="development"} 1'
    );
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

  test('a merged registry that fails answers 500 instead of crashing', async () => {
    const failing = [{ metrics: async () => Promise.reject(new Error('down')) }];
    const response = await fetchMetricsHandler(prometheusRegistry(), { merge: failing })();
    expect(response.status).toBe(500);
    const written: { status?: number } = {};
    const node = {
      setHeader: () => {},
      end: () => {},
      set statusCode(value: number) {
        written.status = value;
      },
    };
    await metricsHandler(prometheusRegistry(), { merge: failing })({}, node);
    expect(written.status).toBe(500);
  });
});

describe('label sets', () => {
  test('every series of a counter carries the same labels', () => {
    const metrics = prometheusRegistry();
    const telemetry = createTelemetry({ exporters: [metrics], dedupeWindowMs: 0 });
    telemetry.record({
      ...base,
      kind: 'document.open',
      outcome: 'opened',
      sizeBucket: '0-64KiB',
      durationMs: 3,
    } as EditorDiagnostic);
    telemetry.record({
      ...base,
      kind: 'collab.status',
      status: 'ready',
      previous: 'initializing',
      recovering: false,
    } as EditorDiagnostic);
    const text = metrics.metrics();
    expect(text).toMatch(/docx_editor_document_opens_total\{[^}]*code="none"[^}]*\} 1/);
    expect(text).toMatch(
      /docx_editor_collab_client_status_transitions_total\{[^}]*code="none"[^}]*\} 1/
    );
  });
});
