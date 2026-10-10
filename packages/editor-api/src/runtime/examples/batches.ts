/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Independently authored examples of what a batch looks like from the outside.
//
// Written the way a consumer writes: reach an object from `context.document`, build up work against
// it, end with `await context.sync()`, read what came back. They are compiled and executed by
// `__tests__/runtime-examples.test.ts` against a real document, so they cannot drift into
// pseudocode — which is the whole reason they are here rather than in prose.
//
// They use the published object model. Anyone who has written against Word's own JavaScript API
// should recognize every line; what is worth reading them for is WHERE the syncs are, because that
// is the part a batching API cannot hide and the part that decides what is atomic.

import type { DocxEditorRuntime } from '../runtime.ts';

/** Read the whole story: one load, one sync, one property. */
export async function readBodyText(runtime: DocxEditorRuntime): Promise<string> {
  return runtime.run(async (context) => {
    const body = context.document.body;
    body.load('text');
    await context.sync();
    return body.text;
  });
}

/**
 * Write into every paragraph in one batch.
 *
 * Two syncs, and the reason is worth seeing in an example: the first finds out which paragraphs
 * exist, the second is the ONE atomic batch that writes to all of them. If any of those writes
 * were refused, none of them would have happened.
 */
export async function prefixEveryParagraph(
  runtime: DocxEditorRuntime,
  prefix: string
): Promise<number> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();

    for (const paragraph of paragraphs.items) paragraph.insertText(prefix, 'Start');
    await context.sync();
    return paragraphs.items.length;
  });
}

/**
 * Read a paragraph that may not be there.
 *
 * The lookup answers an object immediately so the batch can keep being built; whether it found
 * anything is only known after the sync, which is what `isNullObject` is for.
 */
export async function firstParagraphTextOrNull(runtime: DocxEditorRuntime): Promise<string | null> {
  return runtime.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirstOrNullObject();
    await context.sync();
    if (paragraph.isNullObject) return null;

    paragraph.load('text');
    await context.sync();
    return paragraph.text;
  });
}

/**
 * A Word sample, run against a real document.
 *
 * The statements are those of `compat/fixtures/source-compat/search-and-format.ts#replaceFirstMatch`
 * — a namespace-rewritten Office.js sample, type-checked against the authored declarations — plus
 * ONE MORE SYNC, and the extra sync is the interesting part.
 *
 * `getFirst()` answers a proxy the runtime cannot address yet: which range it names is the answer to
 * a read, and a read's answer arrives with a sync. Writing through it before then is refused rather
 * than guessed, because the alternative is sending several batches per `sync()` and giving up "one
 * sync is one atomic batch". Upstream resolves item paths on its own side and needs no such sync, so
 * this is a real difference in what runs — the sample's source compiles unchanged either way, which
 * is what `__tests__/runtime-examples.test.ts` holds in place.
 */
export async function replaceFirstMatch(
  runtime: DocxEditorRuntime,
  searchText: string,
  replacement: string
): Promise<void> {
  await runtime.run(async (context) => {
    const results = context.document.body.search(searchText);
    await context.sync();
    const first = results.getFirst();
    await context.sync();
    first.insertText(replacement, 'Replace');
    await context.sync();
  });
}

/** Replace every occurrence of some text, in one atomic batch. */
export async function replaceEveryOccurrence(
  runtime: DocxEditorRuntime,
  searchText: string,
  replacement: string
): Promise<number> {
  return runtime.run(async (context) => {
    const found = context.document.body.search(searchText, { matchCase: true });
    found.load();
    await context.sync();

    for (const range of found.items) range.insertText(replacement, 'Replace');
    await context.sync();
    return found.items.length;
  });
}

/**
 * Format the matches of a search, in one atomic batch.
 *
 * The statements are those of `compat/fixtures/source-compat/search-and-format.ts` — a
 * namespace-rewritten Office.js sample — and the syncs are where this runtime needs them: one to
 * find the ranges, one to apply the formatting to all of them. Several properties set on one `font`
 * are ONE write, so a batch that bolds and colours a hundred matches sends a hundred writes, not
 * two hundred.
 */
export async function emphasizeEveryOccurrence(
  runtime: DocxEditorRuntime,
  searchText: string,
  colour: string
): Promise<number> {
  return runtime.run(async (context) => {
    const found = context.document.body.search(searchText, { matchCase: true });
    found.load();
    await context.sync();

    for (const range of found.items) {
      range.font.bold = true;
      range.font.color = colour;
    }
    await context.sync();
    return found.items.length;
  });
}

/**
 * Apply a paragraph style and adjust the paragraph's own spacing together.
 *
 * Both of these rewrite the same paragraph properties, and doing them in one batch is deliberate:
 * they are collected into a single write, so either the whole appearance change happens or none of
 * it does. A style name the document does not define is refused here rather than created.
 */
export async function quoteEveryParagraph(
  runtime: DocxEditorRuntime,
  styleName: string
): Promise<readonly (string | null)[]> {
  return runtime.run(async (context) => {
    const paragraphs = context.document.body.paragraphs;
    paragraphs.load();
    await context.sync();

    for (const paragraph of paragraphs.items) {
      paragraph.style = styleName;
      paragraph.leftIndent = 36;
      paragraph.spaceAfter = 6;
    }
    await context.sync();

    for (const paragraph of paragraphs.items) paragraph.load('style');
    await context.sync();
    return paragraphs.items.map((paragraph) => paragraph.style);
  });
}

/**
 * What a stretch of text agrees about, and what it does not.
 *
 * The interesting answer is `null`: it is what a font property reads when the characters covered
 * disagree, or when nothing sets the property at all. Code that formats a selection needs to tell
 * "they are all bold" from "some of them are".
 */
export async function boldnessOfWholeStory(runtime: DocxEditorRuntime): Promise<boolean | null> {
  return runtime.run(async (context) => {
    const font = context.document.body.font;
    font.load('bold');
    await context.sync();
    return font.bold;
  });
}

/**
 * Keep a paragraph past the run that found it.
 *
 * Tracking is the deliberate half; handing the object to the next `run` is the other. Without
 * both, the object is released when its run ends and every later call on it is refused.
 */
export async function appendToFirstParagraphLater(
  runtime: DocxEditorRuntime,
  suffixLength: number
): Promise<string> {
  const first = await runtime.run(async (context) => {
    const paragraph = context.document.body.paragraphs.getFirst();
    await context.sync();
    paragraph.load('text');
    await context.sync();
    context.trackedObjects.add(paragraph);
    return paragraph;
  });

  return runtime.run(first, async (context) => {
    first.insertText('!'.repeat(suffixLength), 'End');
    await context.sync();

    first.load('text');
    await context.sync();
    return first.text;
  });
}
