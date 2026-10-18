// A document read on a worker opens as its bytes do, without reading them again on the page.
//
// For real files: the session opened from a worker's read holds the same package as the session
// opened from the bytes — same trees, same key order, same frozen state — projects the same body
// and saves the same bytes. An editor created with `parseInWorker` lays out the same pages and
// saves the same file as one without it, with no package read on the page; and every way the
// worker can fail opens the document on the page instead. `structuredClone` stands in for the
// worker's `postMessage` where a test needs no thread; the editor tests run the real worker.
//
// More files can be run through the same comparison by pointing PARSED_DOCUMENT_SAMPLES at a
// directory of .docx files.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PageRecord } from '@docx-editor.dev/core/layout';
import { openTreeSession, openTreeSessionFromPackage } from '../../binding/tree-session.ts';
import { ooxmlPackageReadCount } from '../../store/package/ooxml-package.ts';
import {
  answerParseRequest,
  parseDocument,
  parsedDocumentRead,
  parsedDocumentTransferables,
  type ParsedDocument,
} from '../../store/package/parsed-document.ts';
import { sameGraph } from '../../store/__tests__/same-graph.ts';
import {
  holdParsedRead,
  prepareOpenSteps,
  takePreparedOpen,
} from '../docx-editor-prepared-open.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { createOffThreadParser } from '../parse-off-thread.ts';

const FIXTURES = join(import.meta.dir, '../../../../../e2e/fixtures');
const FILES = [
  'demo.docx',
  'issue-319-sections.docx',
  'issue-68-large-comments-suggestions.docx',
  'footer-textbox-page-fields.docx',
  'float-wrap-comprehensive-test.docx',
].map((name) => join(FIXTURES, name));

const extra = process.env.PARSED_DOCUMENT_SAMPLES;
const EXTRA_FILES = extra
  ? readdirSync(extra, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.docx'))
      .sort()
      .map((name) => join(extra, name))
  : [];

const bytesOf = (path: string) => new Uint8Array(readFileSync(path));

/** The engine's own worker, from source: what `parseInWorker: true` starts from the build. */
const WORKER_URL = new URL('../../parse/worker.ts', import.meta.url);
let workersStarted = 0;
const realWorker = (): Worker => {
  workersStarted += 1;
  return new Worker(WORKER_URL);
};

/** What a worker's answer is on arrival. */
function posted(bytes: Uint8Array): ParsedDocument {
  const parsed = parseDocument(bytes.slice());
  return structuredClone(parsed, { transfer: parsedDocumentTransferables(parsed) });
}

function compareSessions(path: string): void {
  const bytes = bytesOf(path);
  const inPlace = openTreeSession(bytes);
  const read = parsedDocumentRead(posted(bytes));
  expect(read).not.toBeNull();
  const fromRead = openTreeSessionFromPackage(read!);
  expect(inPlace.ok).toBe(true);
  expect(fromRead.ok).toBe(true);
  if (!inPlace.ok || !fromRead.ok) return;
  expect(sameGraph(fromRead.session.currentPackage(), inPlace.session.currentPackage())).toBeNull();
  expect(fromRead.session.projectDoc().toJSON()).toEqual(inPlace.session.projectDoc().toJSON());
  expect(fromRead.session.paragraphIds()).toEqual(inPlace.session.paragraphIds());
  expect(Buffer.from(fromRead.session.save()).equals(Buffer.from(inPlace.session.save()))).toBe(
    true
  );
}

describe('a session opened from a worker read is the session opened from its bytes', () => {
  for (const path of [...FILES, ...EXTRA_FILES]) {
    test(path.slice(path.lastIndexOf('/') + 1), () => compareSessions(path));
  }
});

describe('the worker protocol', () => {
  test('a request is answered with its number and transferable buffers', () => {
    const bytes = bytesOf(FILES[1]!);
    const answer = answerParseRequest({ id: 7, bytes });
    expect(answer?.reply.id).toBe(7);
    expect(answer?.reply.parsed?.kind).toBe('docx-editor.parsed-document');
    expect(answer?.transfer.length).toBeGreaterThan(0);
  });

  test('anything else gets no answer', () => {
    for (const data of [null, 'bytes', { id: 1 }, { id: '1', bytes: new Uint8Array(1) }]) {
      expect(answerParseRequest(data)).toBeNull();
    }
  });
});

/** What a page shows, by text: the body lines, then the note lines. */
function pageText(page: PageRecord): string {
  const lines = (fragments: PageRecord['fragments']) =>
    fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? fragment.lines.map((line) => line.spans.map((span) => span.text).join(''))
        : []
    );
  const notes = (page.footnotes?.notes ?? []).flatMap((note) => lines(note.fragments));
  return [...lines(page.fragments), '--', ...notes].join('\n');
}

const editors: DocxEditorInstance[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

async function settled(editor: DocxEditorInstance): Promise<void> {
  const deadline = Date.now() + 20_000;
  const waiting = () =>
    (editor.surface === null && editor.snapshot().parseError === null) ||
    editor.snapshot().isOpening;
  while (waiting() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** An attached editor on `document`, once every page is laid out. */
async function opened(
  document: Uint8Array,
  parseInWorker?: boolean | (() => Worker)
): Promise<DocxEditorInstance> {
  const editor = createDocxEditor({ document, ...(parseInWorker ? { parseInWorker } : {}) });
  editors.push(editor);
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  editor.attach(container);
  await settled(editor);
  if (!editor.surface) throw new Error(`no surface: ${editor.snapshot().parseError ?? ''}`);
  return editor;
}

describe('an editor that reads documents on a worker', () => {
  for (const path of [...FILES.slice(0, 3), ...EXTRA_FILES]) {
    test(`${path.slice(path.lastIndexOf('/') + 1)}: same pages, same save, no read here`, async () => {
      const plain = await opened(bytesOf(path));
      const reads = ooxmlPackageReadCount();
      const started = workersStarted;
      const fromWorker = await opened(bytesOf(path), realWorker);
      expect(workersStarted).toBe(started + 1);
      expect(ooxmlPackageReadCount()).toBe(reads);
      expect(fromWorker.surface!.layout().pages.map(pageText)).toEqual(
        plain.surface!.layout().pages.map(pageText)
      );
      const [left, right] = await Promise.all([fromWorker.save(), plain.save()]);
      expect(Buffer.from(left).equals(Buffer.from(right))).toBe(true);
    }, 60_000);
  }

  test('a small document opens on the page, without a worker', async () => {
    const started = workersStarted;
    const editor = await opened(bytesOf(join(FIXTURES, 'editable-sample.docx')), realWorker);
    expect(workersStarted).toBe(started);
    expect(editor.snapshot().parseError).toBeNull();
  });

  test('a large file the reader refuses is refused as its bytes are', async () => {
    // Past the yield threshold, so the open is prepared, and the worker carries the refusal.
    const garbage = new Uint8Array(600 * 1024).fill(7);
    const plain = createDocxEditor({ document: garbage });
    const fromWorker = createDocxEditor({ document: garbage, parseInWorker: realWorker });
    editors.push(plain, fromWorker);
    for (const editor of [plain, fromWorker]) {
      const container = window.document.createElement('div');
      window.document.body.appendChild(container);
      editor.attach(container);
      await settled(editor);
    }
    expect(plain.snapshot().parseError).not.toBeNull();
    expect(fromWorker.snapshot().parseError).toBe(plain.snapshot().parseError);
  }, 60_000);

  test('load() reads on the worker too', async () => {
    const editor = await opened(bytesOf(FILES[1]!), realWorker);
    const reads = ooxmlPackageReadCount();
    const started = workersStarted;
    editor.load(bytesOf(FILES[0]!));
    await settled(editor);
    expect(workersStarted).toBe(started + 1);
    expect(ooxmlPackageReadCount()).toBe(reads);
    expect(editor.snapshot().parseError).toBeNull();
  }, 60_000);

  describe('a worker that cannot serve the read opens the document on the page', () => {
    const cases: Record<string, () => Worker> = {
      'it cannot be created': () => {
        throw new Error('blocked by policy');
      },
      'its script is missing': () => new Worker(new URL('./no-such-worker.ts', import.meta.url)),
      'it answers something else': () =>
        new Worker(
          URL.createObjectURL(new Blob(['onmessage = () => postMessage({ id: -1, parsed: null })']))
        ),
    };
    for (const [name, create] of Object.entries(cases)) {
      test(
        name,
        async () => {
          const plain = await opened(bytesOf(FILES[0]!));
          const reads = ooxmlPackageReadCount();
          const editor = await opened(bytesOf(FILES[0]!), create);
          expect(ooxmlPackageReadCount()).toBe(reads + 1);
          expect(editor.surface!.layout().pages.map(pageText)).toEqual(
            plain.surface!.layout().pages.map(pageText)
          );
        },
        60_000
      );
    }
  });

  test('a newer load stops the worker read it supersedes', async () => {
    const terminated: string[] = [];
    // A worker that never answers: only the newer load can end it.
    const silent = (): Worker => {
      const worker = new Worker(URL.createObjectURL(new Blob(['onmessage = () => {}'])));
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        terminated.push('silent');
        terminate();
      };
      return worker;
    };
    const editor = createDocxEditor({ document: bytesOf(FILES[0]!), parseInWorker: silent });
    editors.push(editor);
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    editor.attach(container);
    for (let wait = 0; wait < 200 && terminated.length === 0; wait += 1) {
      if (editor.snapshot().isOpening) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    editor.load(bytesOf(FILES[1]!));
    expect(terminated).toEqual(['silent']);
    editor.destroy();
  });

  test('destroy stops a worker read in flight', async () => {
    const terminated: string[] = [];
    const silent = (): Worker => {
      const worker = new Worker(URL.createObjectURL(new Blob(['onmessage = () => {}'])));
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        terminated.push('silent');
        terminate();
      };
      return worker;
    };
    const editor = createDocxEditor({ document: bytesOf(FILES[0]!), parseInWorker: silent });
    const container = window.document.createElement('div');
    window.document.body.appendChild(container);
    editor.attach(container);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(terminated).toEqual([]);
    editor.destroy();
    expect(terminated).toEqual(['silent']);
  });
});

describe('the off-thread parser', () => {
  test('is off unless asked for', () => {
    expect(createOffThreadParser(undefined, () => null)).toBeNull();
    expect(createOffThreadParser(false, () => null)).toBeNull();
  });

  test('answers the read of the bytes, and leaves the caller its bytes', async () => {
    const parser = createOffThreadParser(realWorker, () => null)!;
    const bytes = bytesOf(FILES[1]!);
    const read = await parser.read(bytes);
    expect(read?.ok).toBe(true);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("the open scheduler's prepare steps", () => {
  test('a held read is prepared without a package read, once', () => {
    const bytes = bytesOf(FILES[0]!);
    const read = parsedDocumentRead(posted(bytes))!;
    holdParsedRead(bytes, read);
    const reads = ooxmlPackageReadCount();
    let step: ReturnType<typeof prepareOpenSteps> | void = prepareOpenSteps(
      bytes,
      {},
      () => undefined
    );
    while (typeof step === 'function') step = step();
    expect(ooxmlPackageReadCount()).toBe(reads);
    const taken = takePreparedOpen(bytes);
    expect(taken.openedSession?.ok).toBe(true);
    expect(takePreparedOpen(bytes)).toEqual({});
  });
});
