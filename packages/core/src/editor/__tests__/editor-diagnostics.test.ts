// Anonymous diagnostics: what the facade reports when a document opens, fails to open, or an
// edit is refused, and what it must never report. The document text, part names, relationship
// targets and author names are user data, so every assertion on a refusal also scans the
// serialized events and error messages for the strings the fixture planted.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { EditorDiagnostic } from '../../contracts/diagnostics.ts';
import { DIAGNOSTIC_SCHEMA_VERSION } from '../../contracts/diagnostics.ts';
import { diagnosticCodes, explainDiagnostic } from '../../contracts/diagnostic-hints.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { byteSizeBucket, countBucket } from '../editor-diagnostics.ts';
import { editDiagnosticCode, fontDiagnosticCode, openDiagnosticCode } from '../diagnostic-codes.ts';
import { stubReviewModule } from './review-test-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

/** Strings that belong to the "user" and must never reach a diagnostic or an error message. */
const SECRET_TEXT = 'Confidential settlement terms';
const SECRET_PART = 'client-matter-4471';

function docx(body: string, mainPart = 'word/document.xml', target = mainPart): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/${mainPart}" ContentType="${MAIN}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="${target}"/></Relationships>`
    ),
    [mainPart]: strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
  });
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function observe() {
  const events: EditorDiagnostic[] = [];
  const module = {
    id: 'test-telemetry',
    onDiagnostic: (event: EditorDiagnostic) => events.push(event),
  };
  return { events, module };
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

describe('document.open', () => {
  test('a module sees the open of a document passed at construction', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({
      container: mount(),
      document: docx(paragraph(SECRET_TEXT)),
      modules: [module],
    });
    try {
      const opens = events.filter((event) => event.kind === 'document.open');
      expect(opens).toHaveLength(1);
      const [open] = opens;
      expect(open).toMatchObject({
        kind: 'document.open',
        outcome: 'opened',
        sizeBucket: '0-64KiB',
        pagesBucket: '1',
        schemaVersion: DIAGNOSTIC_SCHEMA_VERSION,
      });
      expect(open!.editorSessionId).toMatch(/^e_/);
      expect(Object.isFrozen(open)).toBe(true);
      expect(JSON.stringify(events)).not.toContain(SECRET_TEXT);
    } finally {
      editor.destroy();
    }
  });

  test('a refused open reports a code, and no part name in the event or the error message', () => {
    const { events, module } = observe();
    const errors: string[] = [];
    // The root relationship points at a part that does not exist.
    const bytes = docx(paragraph(SECRET_TEXT), 'word/document.xml', `word/${SECRET_PART}.xml`);
    const editor = createDocxEditor({ container: mount(), modules: [module] });
    editor.on('error', (error) => errors.push(`${error.code} ${error.message}`));
    try {
      editor.load(bytes);
      const open = events.find((event) => event.kind === 'document.open');
      expect(open).toMatchObject({ kind: 'document.open', outcome: 'rejected' });
      expect(open && 'code' in open && open.code.startsWith('open.')).toBe(true);
      expect(errors).toHaveLength(1);
      for (const text of [JSON.stringify(events), ...errors]) {
        expect(text).not.toContain(SECRET_PART);
        expect(text).not.toContain(SECRET_TEXT);
      }
    } finally {
      editor.destroy();
    }
  });

  test('a source that is not bytes is refused as open.unsupported-source', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({ container: mount(), modules: [module] });
    try {
      editor.load('/reports/q3.docx' as never);
      expect(events).toEqual([
        expect.objectContaining({
          kind: 'document.open',
          outcome: 'rejected',
          code: 'open.unsupported-source',
        }),
      ]);
    } finally {
      editor.destroy();
    }
  });

  test('a remount of the same document is not a second open', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({ document: docx(paragraph('a')), modules: [module] });
    try {
      // Detached until attach: the open is reported once, when it mounts.
      expect(events).toHaveLength(0);
      const container = mount();
      editor.attach(container);
      editor.detach();
      editor.attach(container);
      expect(events.filter((event) => event.kind === 'document.open')).toHaveLength(1);
    } finally {
      editor.destroy();
    }
  });
});

describe('edit.rejected', () => {
  test('a refused command reports one event with its public code', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({
      container: mount(),
      document: docx(paragraph(SECRET_TEXT)),
      modules: [module],
      mode: 'view',
    });
    const seen: EditorDiagnostic[] = [];
    editor.on('diagnostic', (event) => seen.push(event));
    try {
      const result = editor.exec({ type: 'toggleMark', mark: 'bold' });
      expect(result.ok).toBe(false);
      const rejected = events.filter((event) => event.kind === 'edit.rejected');
      expect(rejected).toEqual([
        expect.objectContaining({
          kind: 'edit.rejected',
          origin: 'command',
          command: 'toggleMark',
          tracked: false,
        }),
      ]);
      expect(rejected[0]).not.toMatchObject({ code: 'edit.refused' });
      // `editor.on` and the module hear the same event.
      expect(seen.filter((event) => event.kind === 'edit.rejected')).toEqual(rejected);
      expect(JSON.stringify(events)).not.toContain(SECRET_TEXT);
    } finally {
      editor.destroy();
    }
  });

  test('a listener that throws does not break the editor', () => {
    const editor = createDocxEditor({
      container: mount(),
      document: docx(paragraph('a')),
      modules: [
        {
          id: 'broken-observer',
          onDiagnostic: () => {
            throw new Error('observer failure');
          },
        },
      ],
      mode: 'view',
    });
    try {
      expect(editor.snapshot().parseError).toBeNull();
      expect(() => editor.exec({ type: 'toggleMark', mark: 'bold' })).not.toThrow();
    } finally {
      editor.destroy();
    }
  });
});

describe('review.skipped', () => {
  test('resolving an unknown tracked change reports a count, never the key', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({
      container: mount(),
      document: docx(paragraph('a')),
      modules: [stubReviewModule(), module],
    });
    try {
      const keys = [`ins:${SECRET_PART}:1`, `ins:${SECRET_PART}:2`];
      editor.exec({ type: 'resolveAllReviewChanges', action: 'accept', keys });
      const skipped = events.filter((event) => event.kind === 'review.skipped');
      expect(skipped).toEqual([
        expect.objectContaining({ code: 'review.stale-revision', count: 2 }),
      ]);
      expect(JSON.stringify(events)).not.toContain(SECRET_PART);
    } finally {
      editor.destroy();
    }
  });
});

describe('codes and hints', () => {
  test('every public code has a hint and a docs link', () => {
    const codes = diagnosticCodes();
    expect(codes.length).toBeGreaterThan(40);
    for (const code of codes) {
      const { hint, docs } = explainDiagnostic(code);
      expect(hint.length).toBeGreaterThan(20);
      expect(docs).toBe(
        `https://docx-editor.dev/docs/2.x/guides/diagnostics#${code.split('.')[0]}`
      );
    }
  });

  test('raw reasons map to public codes; unknown text never passes through', () => {
    expect(openDiagnosticCode('too-large', 'zip.maxRatio')).toBe('open.zip-ratio-limit');
    expect(openDiagnosticCode('too-large', 'zip.maxTotalBytes')).toBe('open.zip-size-limit');
    expect(openDiagnosticCode('too-large')).toBe('open.xml-part-size-limit');
    expect(openDiagnosticCode('no-main-document')).toBe('open.missing-main-document');
    expect(openDiagnosticCode('constructor')).toBe('open.failed');
    expect(editDiagnosticCode('trackedDrawingDeletionUnsupported')).toBe(
      'edit.tracked-drawing-delete-unsupported'
    );
    expect(editDiagnosticCode('not-adjacent-siblings')).toBe('edit.cross-structure-join');
    expect(editDiagnosticCode('unsupported-revision:moveFrom')).toBe('edit.revision-unsupported');
    expect(editDiagnosticCode('the document is open for viewing')).toBe('edit.read-only');
    expect(editDiagnosticCode(`a sentence about ${SECRET_TEXT}`)).toBe('edit.refused');
    expect(editDiagnosticCode('a sentence', 'notFound')).toBe('edit.stale-target');
    expect(editDiagnosticCode('__proto__')).toBe('edit.refused');
    expect(fontDiagnosticCode('wasmUnavailable')).toBe('font.shaper-unavailable');
    expect(fontDiagnosticCode(undefined)).toBe('font.load-failed');
  });

  test('sizes and counts are bucketed', () => {
    expect(byteSizeBucket(0)).toBe('0-64KiB');
    expect(byteSizeBucket(64 * 1024)).toBe('64-128KiB');
    expect(byteSizeBucket(5 * 1024 * 1024)).toBe('4-8MiB');
    expect(byteSizeBucket(2 ** 40)).toBe('512MiB+');
    expect([0, 1, 7, 42, 512, 9000].map(countBucket)).toEqual([
      '0',
      '1',
      '2-9',
      '10-99',
      '100-999',
      '1000+',
    ]);
  });
});
