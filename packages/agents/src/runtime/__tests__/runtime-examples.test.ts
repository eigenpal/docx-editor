// The authored examples, executed.
//
// `examples/batches.ts` is what this runtime's documentation looks like: batches written the way
// a consumer writes them, ending in `await context.sync()`. Documentation that is not run rots,
// and rotted documentation about a batching API is worse than none — so it runs here, against a
// real document, through the public entry point.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocxEditor } from '../index.ts';
import {
  appendToFirstParagraphLater,
  boldnessOfWholeStory,
  emphasizeEveryOccurrence,
  firstParagraphTextOrNull,
  quoteEveryParagraph,
  prefixEveryParagraph,
  readBodyText,
  replaceEveryOccurrence,
  replaceFirstMatch,
} from '../examples/batches.ts';
import { docx, p, style } from './support/docx.ts';

const THREE = docx(`${p('one')}${p('two')}${p('three')}`);

describe('the authored examples run against a real document', () => {
  test('reading the story', async () => {
    const runtime = await DocxEditor.createServer(THREE);
    expect(await readBodyText(runtime)).toBe('one\rtwo\rthree');
    runtime.dispose();
  });

  test('writing to every paragraph in one batch', async () => {
    const runtime = await DocxEditor.createServer(THREE);
    expect(await prefixEveryParagraph(runtime, '> ')).toBe(3);
    expect(await readBodyText(runtime)).toBe('> one\r> two\r> three');
    runtime.dispose();
  });

  test('a lookup that finds something, and one that does not', async () => {
    const runtime = await DocxEditor.createServer(THREE);
    expect(await firstParagraphTextOrNull(runtime)).toBe('one');
    runtime.dispose();

    const empty = await DocxEditor.createServer(docx(''));
    expect(await firstParagraphTextOrNull(empty)).toBeNull();
    empty.dispose();
  });

  test('replacing every occurrence of some text', async () => {
    const runtime = await DocxEditor.createServer(docx(`${p('one two')}${p('two one')}`));
    expect(await replaceEveryOccurrence(runtime, 'two', 'TWO')).toBe(2);
    expect(await readBodyText(runtime)).toBe('one TWO\rTWO one');
    runtime.dispose();
  });

  test('keeping an object past the run that found it', async () => {
    const runtime = await DocxEditor.createServer(docx(p('kept')));
    expect(await appendToFirstParagraphLater(runtime, 2)).toBe('kept!!');
    runtime.dispose();
  });

  test('formatting the matches of a search', async () => {
    const runtime = await DocxEditor.createServer(docx(`${p('find me')}${p('and me')}`));
    expect(await emphasizeEveryOccurrence(runtime, 'me', '#B22222')).toBe(2);
    expect(await boldnessOfWholeStory(runtime)).toBeNull();
    runtime.dispose();
  });

  test('styling and spacing every paragraph together', async () => {
    const runtime = await DocxEditor.createServer(
      docx(`${p('one')}${p('two')}`, style('Quote', 'Quote'))
    );
    expect(await quoteEveryParagraph(runtime, 'Quote')).toEqual(['Quote', 'Quote']);
    runtime.dispose();
  });

  test('a Word sample, with the one extra sync this runtime needs', async () => {
    const runtime = await DocxEditor.createServer(docx(`${p('find me')}${p('and me')}`));
    await replaceFirstMatch(runtime, 'me', 'you');
    expect(await readBodyText(runtime)).toBe('find you\rand me');
    runtime.dispose();
  });
});

describe('a source-compatible sample is the same source on both sides', () => {
  // `compat/fixtures/source-compat/` compiles Office.js samples against the AUTHORED DECLARATIONS;
  // this directory runs them against the IMPLEMENTATION. Those are two different claims, and what
  // makes them one claim about one sample is that the statements are the same statements.
  //
  // A SUBSEQUENCE, not an equality, and the gap is named rather than papered over: the executed
  // version needs one more `await context.sync()` than the declared one, because an item accessor's
  // result is not addressable until a read has answered. Every OTHER line has to match — a renamed
  // method or a changed argument order would show up here as a missing statement.
  const COMPAT = join(import.meta.dir, '..', '..', '..', 'compat');

  /** The statements of one exported function, trimmed, comments and blank lines dropped. */
  function statementsOf(source: string, name: string): string[] {
    const start = source.indexOf(`export async function ${name}`);
    if (start < 0) throw new Error(`no such example: ${name}`);
    const body = source.slice(source.indexOf('{', start) + 1);
    const end = body.indexOf('\n}');
    if (end < 0) throw new Error(`example ${name} has no end`);
    return body
      .slice(0, end)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('*'));
  }

  /** Whether `whole` contains `part`'s lines in order. */
  function containsInOrder(whole: readonly string[], part: readonly string[]): boolean {
    let at = 0;
    for (const line of part) {
      const found = whole.indexOf(line, at);
      if (found < 0) return false;
      at = found + 1;
    }
    return true;
  }

  test('the executed example contains every statement of the declared fixture, in order', () => {
    // How the batch is opened differs by construction — `DocxEditor.run` against the declarations,
    // `runtime.run` against a document this process opened — so that line is dropped from both.
    const inner = (lines: readonly string[]): string[] =>
      lines.filter((line) => !line.includes('.run('));
    const declared = inner(
      statementsOf(
        readFileSync(join(COMPAT, 'fixtures', 'source-compat', 'search-and-format.ts'), 'utf8'),
        'replaceFirstMatch'
      )
    );
    const executed = inner(
      statementsOf(
        readFileSync(join(import.meta.dir, '..', 'examples', 'batches.ts'), 'utf8'),
        'replaceFirstMatch'
      )
    );

    expect(declared.length).toBeGreaterThanOrEqual(4);
    expect(containsInOrder(executed, declared)).toBe(true);
    // Exactly one statement more, and it is the sync the runtime needs.
    expect(executed.length).toBe(declared.length + 1);
    expect(
      containsInOrder(executed, ['const first = results.getFirst();', 'await context.sync();'])
    ).toBe(true);
  });

  test('and the comparison would notice a statement that stopped matching', () => {
    // The control: without it, a broken extractor returning nothing would pass the test above.
    expect(containsInOrder(['a', 'b', 'c'], ['a', 'c'])).toBe(true);
    expect(containsInOrder(['a', 'b', 'c'], ['c', 'a'])).toBe(false);
    expect(containsInOrder(['a'], ['a', 'b'])).toBe(false);
  });
});
