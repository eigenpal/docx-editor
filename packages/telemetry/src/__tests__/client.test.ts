/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor, type EditorDiagnostic } from '@docx-editor.dev/core';
import {
  createTelemetry,
  consoleExporter,
  memoryExporter,
  METRICS,
  prometheusName,
  type TelemetryExporter,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const SECRET = 'Privileged settlement memo';

function docx(target = 'word/document.xml'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="${target}"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>${SECRET}</w:t></w:r></w:p></w:body></w:document>`
    ),
  });
}

const base = { schemaVersion: 1, editorSessionId: 'e_0123456789abcdef', time: 1_700_000_000_000 };
const refusal = (code = 'edit.read-only'): EditorDiagnostic =>
  ({ ...base, kind: 'edit.rejected', code, origin: 'input', tracked: false }) as EditorDiagnostic;

const editors: { destroy(): void }[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function mount(document: Uint8Array, modules: Parameters<typeof createDocxEditor>[0]['modules']) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const editor = createDocxEditor({ container, document, modules, mode: 'view' });
  editors.push(editor);
  return editor;
}

describe('createTelemetry with a real editor', () => {
  test('the module records the open and a refused command, with hints and no content', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({
      exporters: [memory],
      resource: { 'service.name': 'contracts-app' },
    });
    const editor = mount(docx(), [telemetry.module]);
    editor.exec({ type: 'toggleMark', mark: 'bold' });

    const kinds = memory.events.map((event) => event.kind);
    expect(kinds).toEqual(['document.open', 'edit.rejected']);
    const rejected = memory.events[1]!;
    expect(rejected).toMatchObject({
      code: 'edit.read-only',
      origin: 'command',
      engineVersion: 'development',
      resource: { 'service.name': 'contracts-app' },
    });
    expect(rejected.hint).toContain('viewing');
    expect(rejected.docs).toBe(
      'https://docx-editor.dev/docs/2.x/guides/diagnostics#edit-read-only'
    );
    expect(JSON.stringify(memory.events)).not.toContain(SECRET);

    const names = memory.metrics.map((record) => prometheusName(record.definition));
    expect(names).toContain('docx_editor_document_opens_total');
    expect(names).toContain('docx_editor_document_open_duration_seconds');
    expect(names).toContain('docx_editor_edit_rejections_total');
  });

  test('a refused open is recorded with its code, never the part name', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    mount(docx('word/client-matter-4471.xml'), [telemetry.module]);
    const [open] = memory.events;
    expect(open).toMatchObject({ kind: 'document.open', outcome: 'rejected' });
    expect(JSON.stringify(memory.events)).not.toContain('client-matter-4471');
  });
});

describe('createTelemetry behavior', () => {
  test('include selects areas; tracked refusals belong to trackedChanges', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({
      exporters: [memory],
      include: { trackedChanges: true },
      dedupeWindowMs: 0,
    });
    telemetry.record(refusal());
    telemetry.record({
      ...refusal('edit.tracked-drawing-delete-unsupported'),
      tracked: true,
    } as EditorDiagnostic);
    // A refusal about tracking itself belongs there too, though tracking was off.
    telemetry.record(refusal('edit.tracking-required'));
    expect(memory.events.map((event) => (event as { code?: string }).code)).toEqual([
      'edit.tracked-drawing-delete-unsupported',
      'edit.tracking-required',
    ]);
  });

  test('a code or kind outside the closed lists is counted as dropped and never a label', async () => {
    const { prometheusRegistry } = await import('../prometheus/index.ts');
    const metrics = prometheusRegistry();
    const telemetry = createTelemetry({ exporters: [metrics], dedupeWindowMs: 0 });
    telemetry.record(refusal('JohnSmith_NDA'));
    telemetry.record({ ...base, kind: 'future.kind' } as unknown as EditorDiagnostic);
    const text = metrics.metrics();
    expect(text).not.toContain('JohnSmith');
    expect(text).not.toContain('docx_editor_edit_rejections_total');
    expect(text).toContain(
      'docx_editor_telemetry_dropped_events_total{docx_editor_version="development",reason="unknown-code"} 1'
    );
    expect(text).toContain(
      'docx_editor_telemetry_dropped_events_total{docx_editor_version="development",reason="unknown-kind"} 1'
    );
  });

  test('identical refusals inside the window are one event, then one summary', async () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    for (let i = 0; i < 214; i += 1) telemetry.record(refusal());
    expect(memory.events).toHaveLength(1);
    await telemetry.flush();
    expect(memory.events).toHaveLength(2);
    expect(memory.events[1]!.repeated).toBe(213);
    // Metrics count every event.
    const counted = memory.metrics.filter((record) => record.definition === METRICS.editRejections);
    expect(counted).toHaveLength(214);
  });

  test('consent is read before each event; nothing is buffered before it', () => {
    const memory = memoryExporter();
    let agreed = false;
    const telemetry = createTelemetry({
      exporters: [memory],
      consent: () => agreed,
      dedupeWindowMs: 0,
    });
    telemetry.record(refusal());
    expect(memory.events).toHaveLength(0);
    expect(memory.metrics).toHaveLength(0);
    agreed = true;
    telemetry.record(refusal());
    expect(memory.events).toHaveLength(1);
  });

  test('sampleRate 0 sends no events but still counts metrics', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({
      exporters: [memory],
      include: { editing: { sampleRate: 0 } },
    });
    telemetry.record(refusal());
    expect(memory.events).toHaveLength(0);
    expect(memory.metrics).toHaveLength(1);
  });

  test('a failing exporter is reported once and never reaches the caller', () => {
    const memory = memoryExporter();
    const failures: string[] = [];
    const broken: TelemetryExporter = {
      name: 'broken',
      event() {
        throw new Error('network down');
      },
    };
    const telemetry = createTelemetry({
      exporters: [broken, memory],
      onExporterError: (_error, name) => failures.push(name),
      dedupeWindowMs: 0,
    });
    expect(() => {
      telemetry.record(refusal());
      telemetry.record(refusal());
    }).not.toThrow();
    expect(failures).toEqual(['broken']);
    expect(memory.events).toHaveLength(2);
  });

  test('the anonymity guard drops unknown fields and codes', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory], dedupeWindowMs: 0 });
    const warn = console.warn;
    console.warn = () => {};
    try {
      telemetry.record({ ...refusal(), text: SECRET } as unknown as EditorDiagnostic);
      telemetry.record(refusal('edit.made-up' as never));
    } finally {
      console.warn = warn;
    }
    expect(memory.events).toHaveLength(1);
    expect(JSON.stringify(memory.events)).not.toContain(SECRET);
  });

  test('a burst of participant counts sends the first and then only the latest', async () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    for (const count of [2, 3, 4, 5])
      telemetry.record({ ...base, kind: 'collab.participants', count } as EditorDiagnostic);
    await telemetry.flush();
    expect(memory.events.map((event) => (event as { count?: number }).count)).toEqual([2, 5]);
    expect(memory.events.every((event) => event.repeated === undefined)).toBe(true);
  });

  test('an event with an invalid known field is dropped whole', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory], dedupeWindowMs: 0 });
    const warn = console.warn;
    console.warn = () => {};
    try {
      telemetry.record({
        ...refusal(),
        origin: 'a free-text origin',
      } as unknown as EditorDiagnostic);
    } finally {
      console.warn = warn;
    }
    expect(memory.events).toHaveLength(0);
  });

  test('the detailed document shape is sent only when asked for', () => {
    const opened = {
      ...base,
      kind: 'document.open',
      outcome: 'opened',
      sizeBucket: '0-64KiB',
      pagesBucket: '1',
      durationMs: 20,
      shape: { parts: '2-9', paragraphs: '10-99', reviewItems: '0', embeddedFonts: '0' },
    } as EditorDiagnostic;
    const basic = memoryExporter();
    createTelemetry({ exporters: [basic] }).record(opened);
    expect(basic.events[0]).not.toHaveProperty('shape');
    const detailed = memoryExporter();
    createTelemetry({ exporters: [detailed], documentShape: 'detailed' }).record(opened);
    expect(detailed.events[0]).toMatchObject({ shape: { paragraphs: '10-99' } });
  });

  test('history diagnostics are their own area and never a failure', () => {
    const lines: string[] = [];
    const telemetry = createTelemetry({
      exporters: [
        consoleExporter({
          console: {
            info: (line) => lines.push(`info ${line}`),
            warn: (line) => lines.push(`warn ${line}`),
          },
        }),
      ],
      include: { history: true },
    });
    telemetry.record({ ...base, kind: 'history', code: 'history.split' } as EditorDiagnostic);
    telemetry.record(refusal());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith('info [docx-editor] undo history: history.split');
  });

  test('no window opens before consent, so no orphan summary is sent', async () => {
    const memory = memoryExporter();
    let agreed = false;
    const telemetry = createTelemetry({ exporters: [memory], consent: () => agreed });
    telemetry.record(refusal());
    agreed = true;
    telemetry.record(refusal());
    await telemetry.flush();
    expect(memory.events).toHaveLength(1);
    expect(memory.events[0]!.repeated).toBeUndefined();
  });

  test('a collaboration error that stops recovering is its own event', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    const status = (recovering: boolean) =>
      ({
        ...base,
        kind: 'collab.status',
        status: 'error',
        previous: 'ready',
        code: 'collab.remote-apply-failed',
        recovering,
      }) as EditorDiagnostic;
    telemetry.record(status(true));
    telemetry.record(status(false));
    expect(memory.events.map((event) => (event as { recovering?: boolean }).recovering)).toEqual([
      true,
      false,
    ]);
  });

  test('a summary of a ready status does not repeat the join time', async () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    const ready = {
      ...base,
      kind: 'collab.status',
      status: 'ready',
      previous: 'initializing',
      recovering: false,
      connectMs: 800,
    } as EditorDiagnostic;
    telemetry.record(ready);
    telemetry.record(ready);
    await telemetry.flush();
    const [first, summary] = memory.events as ((typeof memory.events)[number] & {
      connectMs?: number;
    })[];
    expect(first!.connectMs).toBe(800);
    expect(summary!.repeated).toBe(1);
    expect(summary).not.toHaveProperty('connectMs');
  });

  test('a headless open prints no page count', () => {
    const lines: string[] = [];
    const telemetry = createTelemetry({
      exporters: [
        consoleExporter({ console: { info: (line) => lines.push(line), warn: () => {} } }),
      ],
    });
    telemetry.record({
      ...base,
      kind: 'document.open',
      outcome: 'opened',
      sizeBucket: '0-64KiB',
      durationMs: 12,
    } as EditorDiagnostic);
    expect(lines[0]).toBe('[docx-editor] document opened: 0-64KiB, 12 ms');
  });

  test('expected refusals are not failures', async () => {
    const { isFailure } = await import('../index.ts');
    const as = (code: string) => ({ ...refusal(code), engineVersion: 'x', resource: {} }) as never;
    expect(isFailure(as('edit.stale-target'))).toBe(false);
    expect(isFailure(as('edit.read-only'))).toBe(false);
    expect(isFailure(as('edit.protected-content'))).toBe(false);
    const routine = (kind: string, code: string) =>
      ({ kind, code, engineVersion: 'x', resource: {} }) as never;
    expect(isFailure(routine('font.failed', 'font.missing'))).toBe(false);
    expect(isFailure(routine('font.failed', 'font.load-failed'))).toBe(true);
    expect(isFailure(routine('review.skipped', 'review.stale-revision'))).toBe(false);
    expect(isFailure(routine('review.skipped', 'review.revision-unsupported'))).toBe(true);
    expect(isFailure(as('edit.tracked-drawing-delete-unsupported'))).toBe(true);
    // A deduplication summary repeats an event already reported.
    expect(
      isFailure({
        ...(as('edit.tracked-drawing-delete-unsupported') as object),
        repeated: 3,
      } as never)
    ).toBe(false);
  });

  test('failureCount totals failures with summaries included, unlike isFailure', async () => {
    const { failureCount, isFailure } = await import('../index.ts');
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory] });
    for (let i = 0; i < 5; i += 1)
      telemetry.record(refusal('edit.tracked-drawing-delete-unsupported'));
    for (let i = 0; i < 3; i += 1) telemetry.record(refusal('edit.read-only'));
    await telemetry.flush();
    // Two first events and two summaries.
    expect(memory.events.map((event) => event.repeated)).toEqual([undefined, undefined, 4, 2]);
    const sum = (count: (event: (typeof memory.events)[number]) => number) =>
      memory.events.reduce((total, event) => total + count(event), 0);
    expect(sum(failureCount)).toBe(5);
    expect(sum((event) => (isFailure(event) ? 1 : 0))).toBe(1);
  });

  test('a dropped event is counted by reason, so a version mismatch is visible', () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory], dedupeWindowMs: 0 });
    const warn = console.warn;
    console.warn = () => {};
    try {
      telemetry.record(refusal('edit.from-a-newer-core' as never));
    } finally {
      console.warn = warn;
    }
    expect(memory.events).toHaveLength(0);
    expect(memory.metrics).toContainEqual(
      expect.objectContaining({
        definition: METRICS.droppedEvents,
        attributes: { reason: 'unknown-code', 'docx_editor.version': 'development' },
      })
    );
  });

  test('shutdown stops recording', async () => {
    const memory = memoryExporter();
    const telemetry = createTelemetry({ exporters: [memory], dedupeWindowMs: 0 });
    await telemetry.shutdown();
    telemetry.record(refusal());
    expect(memory.events).toHaveLength(0);
  });
});

describe('consoleExporter', () => {
  test('prints the headline, the hint, and the docs link as a warning', () => {
    const lines: string[] = [];
    const telemetry = createTelemetry({
      exporters: [
        consoleExporter({ console: { info: () => {}, warn: (line) => lines.push(line) } }),
      ],
    });
    telemetry.record({
      ...refusal('edit.tracked-drawing-delete-unsupported'),
      tracked: true,
    } as EditorDiagnostic);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toStartWith(
      '[docx-editor] edit refused: edit.tracked-drawing-delete-unsupported (input, tracked)'
    );
    expect(lines[0]).toContain('cannot record a drawing deletion as a tracked change');
    expect(lines[0]).toContain(
      'https://docx-editor.dev/docs/2.x/guides/diagnostics#edit-tracked-drawing-delete-unsupported'
    );
  });
});
