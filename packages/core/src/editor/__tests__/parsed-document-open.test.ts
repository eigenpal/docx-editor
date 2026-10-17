// A document parsed ahead of its open opens as its bytes do, without reading them again.
//
// For real files: the session opened from a parsed document's read holds the same package as
// the session opened from the bytes — same trees, same key order, same frozen state — projects
// the same body and saves the same bytes; and an editor handed the parsed document lays out the
// same pages and saves the same file as an editor handed the bytes, with no package read of
// its own. `structuredClone` stands in for the worker's `postMessage`.
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

describe('a session opened from a parsed document is the session opened from its bytes', () => {
  for (const path of [...FILES, ...EXTRA_FILES]) {
    test(path.slice(path.lastIndexOf('/') + 1), () => compareSessions(path));
  }
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

/** An attached editor on `document`, once every page is laid out. */
async function opened(document: Uint8Array | ParsedDocument): Promise<DocxEditorInstance> {
  const editor = createDocxEditor({ document });
  editors.push(editor);
  const container = window.document.createElement('div');
  window.document.body.appendChild(container);
  editor.attach(container);
  const deadline = Date.now() + 20_000;
  while ((editor.surface === null || editor.snapshot().isOpening) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!editor.surface) throw new Error(`no surface: ${editor.snapshot().parseError ?? ''}`);
  return editor;
}

describe('an editor opened on a parsed document', () => {
  for (const path of [...FILES.slice(0, 3), ...EXTRA_FILES]) {
    test(`${path.slice(path.lastIndexOf('/') + 1)}: same pages, same save, no read`, async () => {
      const bytes = bytesOf(path);
      const plain = await opened(bytes);
      const parsed = posted(bytes);
      const reads = ooxmlPackageReadCount();
      const fromParsed = await opened(parsed);
      expect(ooxmlPackageReadCount()).toBe(reads);
      expect(fromParsed.surface!.layout().pages.map(pageText)).toEqual(
        plain.surface!.layout().pages.map(pageText)
      );
      const [left, right] = await Promise.all([fromParsed.save(), plain.save()]);
      expect(Buffer.from(left).equals(Buffer.from(right))).toBe(true);
    }, 60_000);
  }

  test('a parsed document of a refused file is refused as its bytes are', async () => {
    const garbage = new TextEncoder().encode('not a zip');
    const plain = createDocxEditor({ document: garbage });
    const fromParsed = createDocxEditor({ document: posted(garbage) });
    editors.push(plain, fromParsed);
    for (const editor of [plain, fromParsed]) {
      editor.attach(window.document.createElement('div'));
    }
    expect(fromParsed.snapshot().parseError).toBe(plain.snapshot().parseError);
    expect(plain.snapshot().parseError).not.toBeNull();
  });

  test('load() takes a parsed document too', async () => {
    const editor = await opened(bytesOf(FILES[1]!));
    const parsed = posted(bytesOf(FILES[0]!));
    const reads = ooxmlPackageReadCount();
    editor.load(parsed);
    const deadline = Date.now() + 20_000;
    while (editor.snapshot().isOpening && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(ooxmlPackageReadCount()).toBe(reads);
    expect(editor.snapshot().parseError).toBeNull();
  });
});

describe("the open scheduler's prepare steps", () => {
  test('a parsed document is prepared without a package read, once', () => {
    const bytes = bytesOf(FILES[0]!);
    const parsed = posted(bytes);
    holdParsedRead(parsed, parsed.bytes);
    const reads = ooxmlPackageReadCount();
    let step: ReturnType<typeof prepareOpenSteps> | void = prepareOpenSteps(
      parsed.bytes,
      {},
      () => undefined
    );
    while (typeof step === 'function') step = step();
    expect(ooxmlPackageReadCount()).toBe(reads);
    const taken = takePreparedOpen(parsed.bytes);
    expect(taken.openedSession?.ok).toBe(true);
    expect(takePreparedOpen(parsed.bytes)).toEqual({});
  });
});
