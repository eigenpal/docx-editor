// One object model, two hosts, one answer.
//
// A consumer's script does not say which host it is running on. `context.document.body.paragraphs`
// over bytes a server opened and over an editor a reader is looking at have to be the same
// paragraphs, or "write it once, run it anywhere" is a slogan. Core already pairs the two hosts at
// the protocol level (`packages/core/src/editor/__tests__/automation-host-parity.test.ts`); what is
// unproven until here is that the MODEL on top of them adds no divergence of its own — a proxy that
// resolves a handle differently, or a read the browser path answers from somewhere else.
//
// So one script is written once and run on both, and its whole transcript is compared. Not a curated
// summary: a divergence in the field nobody thought to assert is what this shape is for.
//
// The exception is deliberate and is the second half of the file. Selection is a capability, not an
// approximation: the browser moves the reader's caret, and the headless host refuses rather than
// pretending. That difference is visible to a consumer on purpose, and it is the ONLY one.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core-contract/editor';
import { createBrowser } from '../../runtime/browser.ts';
import { createServer } from '../../runtime/server.ts';
import { isDocxEditorError } from '../../runtime/errors.ts';
import type { DocxEditorRuntime } from '../../runtime/runtime.ts';
import { REPRESENTATIVE } from './support/documents.ts';

function browserRuntime(): { runtime: DocxEditorRuntime; editor: DocxEditorInstance } {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: REPRESENTATIVE });
  if (!editor.surface) throw new Error('surface failed to mount');
  return { runtime: createBrowser(editor), editor };
}

/** The same document, opened both ways. */
async function bothRuntimes(): Promise<{
  server: DocxEditorRuntime;
  browser: DocxEditorRuntime;
  editor: DocxEditorInstance;
}> {
  const { runtime, editor } = browserRuntime();
  return { server: await createServer(REPRESENTATIVE), browser: runtime, editor };
}

/** Run one script on both, and hand back the two transcripts for whole comparison. */
async function onBoth<T>(
  runtimes: { server: DocxEditorRuntime; browser: DocxEditorRuntime },
  script: (runtime: DocxEditorRuntime) => Promise<T>
): Promise<{ server: T; browser: T }> {
  return { server: await script(runtimes.server), browser: await script(runtimes.browser) };
}

/**
 * Everything this slice can be asked about a document, as one comparable value.
 *
 * Reads only: the write transcript is a separate script, because a read comparison run after an
 * edit would compare two documents rather than two hosts.
 */
async function readEverything(runtime: DocxEditorRuntime): Promise<unknown> {
  return runtime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    const paragraphs = body.paragraphs;
    paragraphs.load();
    const documentParagraphs = context.document.paragraphs;
    documentParagraphs.load();
    const found = body.search('e', { matchCase: true });
    found.load();
    const cased = body.search('North', { matchWholeWord: true });
    cased.load();
    const missing = body.paragraphs.getFirstOrNullObject();
    await context.sync();

    for (const paragraph of paragraphs.items) {
      paragraph.load('text');
      paragraph.load('uniqueLocalId');
    }
    for (const range of found.items) range.load('text');
    for (const range of cased.items) range.load('text');
    await context.sync();

    const firstRangeParagraphs = cased.items[0]?.paragraphs;
    firstRangeParagraphs?.load();
    await context.sync();
    if (firstRangeParagraphs) {
      for (const paragraph of firstRangeParagraphs.items) paragraph.load('text');
      await context.sync();
    }

    return {
      bodyText: body.text,
      paragraphs: paragraphs.items.map((paragraph) => paragraph.text),
      // Identities are compared as VALUES, which is a real claim: minting for a paragraph the file
      // gave no `w14:paraId` is deterministic, so opening the same bytes twice — here, in two
      // different hosts — has to arrive at the same identities in the same order.
      identities: paragraphs.items.map((paragraph) => paragraph.uniqueLocalId),
      documentParagraphCount: documentParagraphs.items.length,
      occurrences: found.items.map((range) => range.text),
      wholeWord: cased.items.map((range) => range.text),
      rangeParagraphs: firstRangeParagraphs?.items.map((paragraph) => paragraph.text) ?? [],
      nullObject: missing.isNullObject,
    };
  });
}

/** Every write this slice can make, in the order a consumer would make them. */
async function writeEverything(runtime: DocxEditorRuntime): Promise<unknown> {
  return runtime.run(async (context) => {
    const body = context.document.body;
    const paragraphs = body.paragraphs;
    paragraphs.load();
    await context.sync();

    const appended = body.insertParagraph('appended', 'End');
    const written = paragraphs.items[1]!.insertText(' (revised)', 'End');
    const pieces = paragraphs.items[0]!.split([' '], true);
    paragraphs.items[3]!.clear();
    await context.sync();

    appended.load('text');
    written.load('text');
    pieces.load();
    await context.sync();
    for (const piece of pieces.items) piece.load('text');
    await context.sync();

    const after = context.document.body;
    after.load('text');
    await context.sync();
    return {
      appended: appended.text,
      written: written.text,
      pieces: pieces.items.map((piece) => piece.text),
      bodyText: after.text,
    };
  });
}

describe('the same script reads the same document on either host', () => {
  test('the fixture is awkward enough for the comparison to mean something', async () => {
    // A guard on the guard: over two plain paragraphs every assertion below would still pass and
    // prove much less. This document has a style cascade, a table with cell paragraphs, inline
    // furniture and section properties.
    const runtime = await createServer(REPRESENTATIVE);
    const texts = (await readEverything(runtime)) as { paragraphs: string[] };
    expect(texts.paragraphs.length).toBeGreaterThanOrEqual(6);
    runtime.dispose();
  });

  test('every read this slice defines answers identically', async () => {
    const runtimes = await bothRuntimes();
    const transcripts = await onBoth(runtimes, readEverything);
    expect(transcripts.browser).toEqual(transcripts.server);
    runtimes.server.dispose();
    runtimes.browser.dispose();
  });

  test('and the document each of them describes is not empty', async () => {
    // The control for the comparison above: two hosts that both answered nothing would agree.
    const runtimes = await bothRuntimes();
    const transcripts = await onBoth(runtimes, readEverything);
    const server = transcripts.server as {
      bodyText: string;
      occurrences: string[];
      identities: string[];
    };
    expect(server.bodyText).toContain('Quarterly report');
    expect(server.occurrences.length).toBeGreaterThan(0);
    // The one the file wrote, plus a minted one per paragraph that had none.
    expect(server.identities[0]).toBe('0A0B0C0D');
    expect(new Set(server.identities).size).toBe(server.identities.length);
    runtimes.server.dispose();
    runtimes.browser.dispose();
  });
});

describe('the same script writes the same document on either host', () => {
  test('every write this slice defines lands identically', async () => {
    const runtimes = await bothRuntimes();
    const transcripts = await onBoth(runtimes, writeEverything);
    expect(transcripts.browser).toEqual(transcripts.server);
    // And the writes did something, so the agreement above is about a changed document.
    const server = transcripts.server as { appended: string; written: string; pieces: string[] };
    expect(server.appended).toBe('appended');
    expect(server.written).toBe(' (revised)');
    expect(server.pieces).toEqual(['Quarterly', 'report']);
    runtimes.server.dispose();
    runtimes.browser.dispose();
  });

  test('and the edit is visible in the editor the browser runtime borrowed', async () => {
    // The other half of "same document": the browser path must have gone through the surface, not
    // around it, or a script would edit a model nobody can see.
    const { runtime, editor } = browserRuntime();
    await writeEverything(runtime);
    const painted = await runtime.run(async (context) => {
      const body = context.document.body;
      body.load('text');
      await context.sync();
      return body.text;
    });
    expect(painted).toContain('appended');
    expect(editor.snapshot().canUndo).toBe(true);
    runtime.dispose();
  });
});

describe('selection is the one thing a consumer can tell the hosts apart by', () => {
  test('the browser moves the reader to the range, and says where it put them', async () => {
    const { runtime, editor } = browserRuntime();
    await runtime.run(async (context) => {
      const found = context.document.body.search('North', { matchCase: true });
      found.load();
      await context.sync();
      found.items[0]!.select();
      await context.sync();
    });

    const selection = editor.surface?.state().selection;
    expect(selection?.anchor.paragraphId).toBe(selection?.head.paragraphId ?? '');
    expect((selection?.head.offset ?? 0) - (selection?.anchor.offset ?? 0)).toBe('North'.length);
    runtime.dispose();
  });

  test('collapsing to one end puts the caret there', async () => {
    const { runtime, editor } = browserRuntime();
    for (const mode of ['Start', 'End'] as const) {
      await runtime.run(async (context) => {
        const found = context.document.body.search('North', { matchCase: true });
        found.load();
        await context.sync();
        found.items[0]!.select(mode);
        await context.sync();
      });
      const selection = editor.surface?.state().selection;
      expect(selection?.anchor.offset).toBe(selection?.head.offset ?? -1);
    }
    runtime.dispose();
  });

  test('the headless host refuses instead of pretending it has a reader', async () => {
    const runtime = await createServer(REPRESENTATIVE);
    const refusal = await runtime.run(async (context) => {
      const found = context.document.body.search('North', { matchCase: true });
      found.load();
      await context.sync();
      try {
        found.items[0]!.select();
      } catch (error) {
        return isDocxEditorError(error) ? error.code : 'untyped';
      }
      return 'accepted';
    });
    expect(refusal).toBe('NotSupported');
    runtime.dispose();
  });

  test('and the capability each runtime reports matches what it will do', async () => {
    const { runtime } = browserRuntime();
    const server = await createServer(REPRESENTATIVE);
    expect(runtime.capabilities.selection).toBe(true);
    expect(server.capabilities.selection).toBe(false);
    runtime.dispose();
    server.dispose();
  });
});
