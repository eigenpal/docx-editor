// The authored examples, executed.
//
// `examples/batches.ts` is what this runtime's documentation looks like: batches written the way
// a consumer writes them, ending in `await context.sync()`. Documentation that is not run rots,
// and rotted documentation about a batching API is worse than none — so it runs here, against a
// real document, through the public entry point.

import { describe, expect, test } from 'bun:test';
import { DocxEditor } from '../index.ts';
import {
  appendToFirstParagraphLater,
  paragraphTextOrNull,
  prefixEveryParagraph,
  readBodyText,
} from '../examples/batches.ts';
import { docx, p } from './support/docx.ts';

const THREE = docx(`${p('one')}${p('two')}${p('three')}`);

describe('the authored examples run against a real document', () => {
  test('reading the story', async () => {
    const runtime = await DocxEditor.createServer(THREE);
    expect(await readBodyText(runtime)).toBe('one\ntwo\nthree');
    runtime.dispose();
  });

  test('writing to every paragraph in one batch', async () => {
    const runtime = await DocxEditor.createServer(THREE);
    expect(await prefixEveryParagraph(runtime, '> ')).toBe(3);
    expect(await readBodyText(runtime)).toBe('> one\n> two\n> three');
    runtime.dispose();
  });

  test('a lookup that finds something, and one that does not', async () => {
    const runtime = await DocxEditor.createServer(THREE);
    expect(await paragraphTextOrNull(runtime, 2)).toBe('three');
    expect(await paragraphTextOrNull(runtime, 3)).toBeNull();
    runtime.dispose();
  });

  test('keeping an object past the run that found it', async () => {
    const runtime = await DocxEditor.createServer(docx(p('kept')));
    expect(await appendToFirstParagraphLater(runtime, 2)).toBe('kept!!');
    runtime.dispose();
  });
});
