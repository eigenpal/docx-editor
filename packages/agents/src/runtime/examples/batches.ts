// Independently authored examples of what a batch looks like from the outside.
//
// Written the way a consumer writes: build up work against proxies, end with `await
// context.sync()`, read what came back. They are compiled and executed by
// `__tests__/runtime-examples.test.ts` against a real document, so they cannot drift into
// pseudocode — which is the whole reason they are here rather than in prose.
//
// They deliberately use the minimal model next door rather than the published object model,
// which is a later slice. What they demonstrate is the LIFECYCLE, and that part will not change
// when the real objects arrive.

import type { DocxEditorRuntime } from '../runtime.ts';
import { MiniDocument } from './minimal-model.ts';

/** Read the whole story: one load, one sync, one property. */
export async function readBodyText(runtime: DocxEditorRuntime): Promise<string> {
  return runtime.run(async (context) => {
    const body = MiniDocument.open(context).body;
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
    const paragraphs = MiniDocument.open(context).body.paragraphs;
    paragraphs.load();
    await context.sync();

    for (const paragraph of paragraphs.items) paragraph.insertText(prefix, 0);
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
export async function paragraphTextOrNull(
  runtime: DocxEditorRuntime,
  index: number
): Promise<string | null> {
  return runtime.run(async (context) => {
    const paragraph = MiniDocument.open(context).body.paragraphs.getItemOrNullObject(index);
    await context.sync();
    if (paragraph.isNullObject) return null;

    paragraph.load('text');
    await context.sync();
    return paragraph.text;
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
    const paragraphs = MiniDocument.open(context).body.paragraphs;
    paragraphs.load();
    await context.sync();

    const paragraph = paragraphs.items[0];
    if (!paragraph) throw new Error('the document has no paragraphs');
    paragraph.load('text');
    await context.sync();
    context.trackedObjects.add(paragraph);
    return paragraph;
  });

  return runtime.run(first, async (context) => {
    first.insertText('!'.repeat(suffixLength), first.text.length);
    await context.sync();

    first.load('text');
    await context.sync();
    return first.text;
  });
}
