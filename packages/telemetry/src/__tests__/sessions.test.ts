/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Sessions, edits, and saves: what the client sends for `session` and `document.save` events,
// and the metrics it records from them. A real editor run checks that no content leaks.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type EditorDiagnostic } from '@docx-editor.dev/core';
import { createTelemetry, isFailure, memoryExporter, METRICS, prometheusName } from '../index.ts';
import { describeEvent } from '../exporters.ts';
import { isSentryIssue } from '../sentry/index.ts';
import { toLogRecord, validateTelemetryEvents } from '../ingest/index.ts';

const base = { schemaVersion: 1, editorSessionId: 'e_0123456789abcdef', time: 1_700_000_000_000 };
const activity = {
  durationMs: 60_000,
  activeMs: 42_500,
  inputEdits: 12,
  commandEdits: 3,
  automationEdits: 0,
};
const start = { ...base, kind: 'session', phase: 'start' } as EditorDiagnostic;
const active = { ...base, kind: 'session', phase: 'active', ...activity } as EditorDiagnostic;
const end = {
  ...base,
  kind: 'session',
  phase: 'end',
  ...activity,
  durationMs: 600_000,
} as EditorDiagnostic;
const saved = {
  ...base,
  kind: 'document.save',
  outcome: 'saved',
  sizeBucket: '64-128KiB',
  durationMs: 35,
} as EditorDiagnostic;
const failed = {
  ...base,
  kind: 'document.save',
  outcome: 'rejected',
  code: 'save.failed',
  durationMs: 4,
  cause: 'exception',
  errorName: 'TypeError',
  stage: 'save',
} as EditorDiagnostic;

/** Each measurement as `name{label=value} value`, without the version label. */
function measured(memory: ReturnType<typeof memoryExporter>): string[] {
  return memory.metrics.map((record) => {
    const labels = Object.entries(record.attributes)
      .filter(([key]) => key !== 'docx_editor.version')
      .map(([key, value]) => `${key}=${value}`)
      .join(',');
    return `${prometheusName(record.definition)}{${labels}} ${record.value}`;
  });
}

describe('sessions and saves', () => {
  test('session events become session, active time, and edit metrics, counted once', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    for (const event of [start, active, end]) telemetry.record(event);
    expect(memory.events.map((event) => event.kind === 'session' && event.phase)).toEqual([
      'start',
      'active',
      'end',
    ]);
    // Edits and active time come from the summary only: the end totals repeat them.
    expect(measured(memory)).toEqual([
      'docx_editor_editor_sessions_total{phase=start} 1',
      'docx_editor_editor_active_time_seconds_total{} 42.5',
      'docx_editor_edits_total{origin=input} 12',
      'docx_editor_edits_total{origin=command} 3',
      'docx_editor_editor_sessions_total{phase=end} 1',
      'docx_editor_editor_session_duration_seconds{} 600',
    ]);
  });

  test('saves become a counter by outcome and code, and a duration for successful saves', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    telemetry.record(saved);
    telemetry.record(failed);
    expect(measured(memory)).toEqual([
      'docx_editor_document_saves_total{outcome=saved,code=none} 1',
      'docx_editor_document_save_duration_seconds{} 0.035',
      'docx_editor_document_saves_total{outcome=rejected,code=save.failed} 1',
    ]);
    expect(memory.events.map((event) => isFailure(event))).toEqual([false, true]);
    expect(memory.events.map((event) => isSentryIssue(event))).toEqual([false, true]);
    expect(memory.events.map((event) => describeEvent(event))).toEqual([
      'document saved: 64-128KiB, 35 ms',
      'save failed: save.failed [exception, TypeError, save] after 4 ms',
    ]);
  });

  test('an area that is off sends nothing and tells the editor not to track sessions', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory], include: { documentOpen: true } });
    for (const event of [start, active, saved]) telemetry.record(event);
    expect(memory.events).toEqual([]);
    expect(memory.metrics).toEqual([]);
    expect(telemetry.module.wantsDiagnostic?.('session')).toBe(false);
    const on = createTelemetry({ exporters: [memory], include: { sessions: true } });
    expect(on.module.wantsDiagnostic?.('session')).toBe(true);
  });

  test('sampling keeps a whole session or none of it, and metrics count every session', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({
      exporters: [memory],
      include: { sessions: { sampleRate: 0.5 } },
    });
    for (let index = 0; index < 40; index += 1) {
      const editorSessionId = `e_${index.toString(16).padStart(16, '0')}`;
      for (const event of [start, active, end]) telemetry.record({ ...event, editorSessionId });
    }
    const phases = new Map<string, string[]>();
    for (const event of memory.events)
      if (event.kind === 'session')
        phases.set(event.editorSessionId, [
          ...(phases.get(event.editorSessionId) ?? []),
          event.phase,
        ]);
    for (const sent of phases.values()) expect(sent).toEqual(['start', 'active', 'end']);
    expect(phases.size).toBeGreaterThan(0);
    expect(phases.size).toBeLessThan(40);
    expect(
      memory.metrics.filter((record) => record.definition === METRICS.editorSessions)
    ).toHaveLength(80);
  });

  test('a session end flushes at once, so it leaves with a closing page', async () => {
    let flushes = 0;
    const telemetry = createTelemetry({
      exporters: [{ name: 'counting', event: () => {}, flush: () => void (flushes += 1) }],
    });
    telemetry.record(start);
    telemetry.record(active);
    expect(flushes).toBe(0);
    telemetry.record(end);
    await Promise.resolve();
    expect(flushes).toBe(1);
  });

  test('summaries read as one line each', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    for (const event of [start, active, end]) telemetry.record(event);
    expect(memory.events.map((event) => describeEvent(event))).toEqual([
      'editor session started',
      'editor activity over 60 s: 43 s active, 15 edits',
      'editor session ended after 600 s: 43 s active, 15 edits',
    ]);
  });

  test('the ingest route keeps complete session and save events and drops incomplete ones', () => {
    const sent = [start, active, end, saved, failed].map((event) => ({
      ...event,
      engineVersion: 'development',
      resource: {},
      attributes: {},
    }));
    const checked = validateTelemetryEvents(sent);
    expect(checked).toHaveLength(5);
    expect(toLogRecord(checked[1]!).message).toBe('session');
    const { inputEdits: _dropped, ...partial } = sent[1] as Record<string, unknown>;
    expect(validateTelemetryEvents([partial])).toEqual([]);
    expect(validateTelemetryEvents([{ ...sent[3], sizeBucket: undefined }])).toEqual([]);
    expect(validateTelemetryEvents([{ ...sent[0], phase: 'paused' }])).toEqual([]);
  });
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const SECRET = 'Privileged settlement memo';

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

test('a real editor sends a whole session and a save, with no document content', async () => {
  const memory = memoryExporter();
  const telemetry = createTelemetry({ exporters: [memory] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = createDocxEditor({ container, document: docx(), modules: [telemetry.module] });
  try {
    await Promise.resolve();
    expect(editor.exec({ type: 'insertText', text: 'Confidential addition' }).ok).toBe(true);
    await editor.save();
  } finally {
    editor.destroy();
    container.remove();
  }
  const kinds = memory.events.map((event) =>
    event.kind === 'session' ? `session.${event.phase}` : event.kind
  );
  expect(kinds).toEqual(
    expect.arrayContaining(['session.start', 'document.save', 'session.active', 'session.end'])
  );
  expect(
    memory.events.find((event) => event.kind === 'session' && event.phase === 'end')
  ).toMatchObject({ commandEdits: 1 });
  const exported = JSON.stringify([memory.events, memory.metrics]);
  expect(exported).not.toContain('Privileged');
  expect(exported).not.toContain('Confidential');
});
