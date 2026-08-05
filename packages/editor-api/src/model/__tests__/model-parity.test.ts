/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
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
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
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

    // Formatting, over a document with a style cascade in it: the heading's bold is DIRECT and its
    // size is inherited, so the two hosts have to agree about which of those is readable here.
    const storyFont = body.font;
    storyFont.load();
    const headingFont = paragraphs.items[0]?.font;
    headingFont?.load();
    const rangeFont = cased.items[0]?.font;
    rangeFont?.load();
    for (const paragraph of paragraphs.items) {
      paragraph.load(['alignment', 'leftIndent', 'spaceBefore', 'lineSpacing', 'style']);
    }
    body.load('style');
    await context.sync();

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
      storyFont: { bold: storyFont.bold, size: storyFont.size },
      headingFont: { bold: headingFont?.bold, size: headingFont?.size },
      rangeFont: { bold: rangeFont?.bold, name: rangeFont?.name },
      paragraphFormat: paragraphs.items.map((paragraph) => ({
        alignment: paragraph.alignment,
        leftIndent: paragraph.leftIndent,
        spaceBefore: paragraph.spaceBefore,
        lineSpacing: paragraph.lineSpacing,
        style: paragraph.style,
      })),
      storyStyle: body.style,
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

    // Formatting writes, in the shape a consumer writes them: several fields on one object, then
    // one sync. The heading is left alone because the split above already owns it this batch.
    const formatted = paragraphs.items[1]!;
    formatted.font.italic = true;
    formatted.font.size = 13;
    formatted.alignment = 'Justified';
    formatted.leftIndent = 24;
    await context.sync();

    appended.load('text');
    written.load('text');
    pieces.load();
    await context.sync();
    for (const piece of pieces.items) piece.load('text');
    await context.sync();

    const after = context.document.body;
    after.load('text');
    const formattedAgain = after.paragraphs;
    formattedAgain.load();
    await context.sync();
    for (const paragraph of formattedAgain.items) {
      paragraph.font.load(['italic', 'size']);
      paragraph.load(['alignment', 'leftIndent']);
    }
    await context.sync();
    return {
      appended: appended.text,
      written: written.text,
      pieces: pieces.items.map((piece) => piece.text),
      bodyText: after.text,
      formatting: formattedAgain.items.map((paragraph) => ({
        italic: paragraph.font.italic,
        size: paragraph.font.size,
        alignment: paragraph.alignment,
        leftIndent: paragraph.leftIndent,
      })),
    };
  });
}

describe('the same script reads the same document on either host', () => {
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
      paragraphFormat: readonly { readonly style: string | null }[];
    };
    expect(server.bodyText).toContain('Quarterly report');
    expect(server.occurrences.length).toBeGreaterThan(0);
    // The one the file wrote, plus a minted one per paragraph that had none.
    expect(server.identities[0]).toBe('0A0B0C0D');
    // The fixture's styles part names `Heading1` `heading 1`, so a host answering the ID rather
    // than the NAME would be caught here as well as by the comparison above.
    expect(server.paragraphFormat[0]?.style).toBe('heading 1');
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

  // WHICHEVER ORDER THE TWO ARE WRITTEN IN. A selection is applied after the batch commits, so a
  // batch that both selects a paragraph and changes it would leave the reader's caret at a position
  // the change moved — or in a paragraph the change removed. Refusing the batch is the answer, and
  // it cannot depend on which call the consumer happened to write first.
  test('selecting a range and editing the same paragraph in one sync is refused either way round', async () => {
    for (const selectFirst of [true, false]) {
      const { runtime, editor } = browserRuntime();
      const before = editor.surface?.state().selection;
      const code = await runtime.run(async (context) => {
        const found = context.document.body.search('North', { matchCase: true });
        found.load();
        await context.sync();
        const range = found.items[0]!;
        try {
          if (selectFirst) {
            range.select();
            range.insertText('!', 'End');
          } else {
            range.insertText('!', 'End');
            range.select();
          }
          await context.sync();
        } catch (error) {
          return isDocxEditorError(error) ? error.code : 'untyped';
        }
        return 'accepted';
      });
      expect(code).toBe('ConflictingChanges');
      // Nothing moved: not the text, and not the caret.
      expect(editor.surface?.state().selection).toEqual(before);
      runtime.dispose();
    }
  });
});

describe('emptying a story that holds a table', () => {
  test('is the same document in the browser as on the server, and survives a save', async () => {
    // The write that takes BLOCKS out of a story: the browser host has to repaint pages rather than
    // edit a run, so it is the one most likely to diverge — and the fixture's story runs through a
    // two-row table.
    const runtimes = await bothRuntimes();
    const transcripts = await onBoth(runtimes, async (runtime) => {
      await runtime.run(async (context) => {
        context.document.body.clear();
        await context.sync();
      });
      return runtime.run(async (context) => {
        const body = context.document.body;
        body.load('text');
        const paragraphs = body.paragraphs;
        paragraphs.load();
        await context.sync();
        for (const paragraph of paragraphs.items) paragraph.load('text');
        await context.sync();
        return { bodyText: body.text, texts: paragraphs.items.map((item) => item.text) };
      });
    });
    expect(transcripts.browser).toEqual(transcripts.server);
    expect(transcripts.server).toEqual({ bodyText: '', texts: [''] });

    // And what the EDITOR the browser runtime borrowed saves reopens as the story the clear left
    // behind — the edit reached the document, not the picture of it on screen.
    const reopened = await createServer(new Uint8Array(await runtimes.editor.save()));
    const after = await reopened.run(async (context) => {
      const paragraphs = context.document.body.paragraphs;
      paragraphs.load();
      await context.sync();
      for (const paragraph of paragraphs.items) paragraph.load('text');
      await context.sync();
      return paragraphs.items.map((item) => item.text);
    });
    expect(after).toEqual(['']);
    reopened.dispose();
    runtimes.server.dispose();
    runtimes.browser.dispose();
  });
});
