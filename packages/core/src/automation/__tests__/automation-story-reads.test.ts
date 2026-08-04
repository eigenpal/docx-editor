// What the protocol answers when an object model asks a document about itself.
//
// Reads only. Everything here is a property of the CANONICAL TREE — traversal order, offset
// vocabulary, paragraph identity, what a story's text is — and every one of them is something
// an object model would otherwise have to guess and get subtly wrong.

import { describe, expect, test } from 'bun:test';
import {
  cell,
  docx,
  open,
  p,
  pWithId,
  paragraphTexts,
  paragraphsOf,
  refusal,
  roots,
  row,
  spanAt,
  spansAt,
  storyText,
  table,
  textAt,
} from './support/protocol.ts';

describe('the paragraphs of a story', () => {
  test('are the body ones, in document order', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}${p('gamma')}`));
    const { body } = roots(host);
    expect(paragraphTexts(host, body)).toEqual(['alpha', 'beta', 'gamma']);
  });

  test('include the paragraphs inside a table, in reading order', () => {
    const host = open(
      docx(
        `${p('head')}${table(row(cell(p('r1c1')), cell(p('r1c2'))), row(cell(p('r2c1'))))}${p('tail')}`
      )
    );
    const { body } = roots(host);
    expect(paragraphTexts(host, body)).toEqual(['head', 'r1c1', 'r1c2', 'r2c1', 'tail']);
  });

  test('descend into a table nested inside a cell', () => {
    const inner = table(row(cell(p('inner'))));
    const host = open(docx(`${table(row(cell(p('outer'), inner)))}${p('after')}`));
    const { body } = roots(host);
    expect(paragraphTexts(host, body)).toEqual(['outer', 'inner', 'after']);
  });

  test('include an empty paragraph, which reads as empty text rather than being skipped', () => {
    const host = open(docx(`${p('alpha')}${p('')}${p('beta')}`));
    const { body } = roots(host);
    expect(paragraphTexts(host, body)).toEqual(['alpha', '', 'beta']);
  });

  test('are none at all in a body that holds no paragraph', () => {
    const host = open(docx(''));
    const { body } = roots(host);
    expect(paragraphsOf(host, body)).toEqual([]);
    expect(storyText(host, body)).toBe('');
  });

  test('are the same handles when asked twice, so a proxy can be held across batches', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    expect(paragraphsOf(host, body)).toEqual(paragraphsOf(host, body));
  });
});

describe("a story's text", () => {
  test('separates paragraphs with a carriage return, the way Word does', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    expect(storyText(host, body)).toBe('alpha\rbeta');
  });

  test('includes table-cell paragraphs, in the same reading order', () => {
    const host = open(docx(`${p('head')}${table(row(cell(p('in'))))}`));
    const { body } = roots(host);
    expect(storyText(host, body)).toBe('head\rin');
  });
});

describe('paragraph identity', () => {
  test("is the document's own w14:paraId when the file wrote one", () => {
    const host = open(docx(pWithId('alpha', '1A2B3C4D')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({ operations: [{ op: 'getParagraphId', paragraph: paragraph! }] });
    expect(textAt(response, 0)).toBe('1A2B3C4D');
  });

  test('is stable across reads and distinct between paragraphs', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const read = () =>
      list.map((paragraph, index) =>
        textAt(
          host.execute({ operations: list.map((h) => ({ op: 'getParagraphId' as const, paragraph: h })) }),
          index
        )
      );
    const first = read();
    expect(first[0]).not.toBe(first[1]);
    expect(read()).toEqual(first);
  });

  test('is never a position: deleting the paragraph before it leaves the identity alone', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const before = textAt(
      host.execute({ operations: [{ op: 'getParagraphId', paragraph: list[1]! }] }),
      0
    );
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    const after = textAt(
      host.execute({ operations: [{ op: 'getParagraphId', paragraph: list[1]! }] }),
      0
    );
    expect(after).toBe(before);
  });
});

describe('a span of a story', () => {
  test('reads the characters between its endpoints inside one paragraph', () => {
    const host = open(docx(p('alphabet')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: paragraph!, offset: 2 },
            end: { paragraph: paragraph!, offset: 5 },
          },
        },
      ],
    });
    expect(textAt(response, 0)).toBe('pha');
  });

  test('reads across paragraphs with a carriage return at each mark', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}${p('gamma')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: { start: { paragraph: list[0]!, offset: 3 }, end: { paragraph: list[2]!, offset: 2 } },
        },
      ],
    });
    expect(textAt(response, 0)).toBe('ha\rbeta\rga');
  });

  test('reads the whole story when it names the body', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const response = host.execute({ operations: [{ op: 'getSpanText', span: { body } }] });
    expect(textAt(response, 0)).toBe('alpha\rbeta');
  });

  test('answers the paragraphs it covers, and no others', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}${p('gamma')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanParagraphs',
          span: { start: { paragraph: list[0]!, offset: 1 }, end: { paragraph: list[1]!, offset: 1 } },
        },
      ],
    });
    const result = response.results[0];
    expect(result?.status).toBe('ok');
    if (result?.status === 'ok' && result.value.kind === 'handles') {
      expect(result.value.handles).toEqual([list[0]!, list[1]!]);
    }
  });

  test('is refused when its endpoints run backwards', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: { start: { paragraph: list[1]!, offset: 0 }, end: { paragraph: list[0]!, offset: 0 } },
        },
      ],
    });
    expect(refusal(response)).toBe('invalid-offset');
  });

  test('is refused when an endpoint is outside its paragraph', () => {
    const host = open(docx(p('alpha')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: paragraph!, offset: 0 },
            end: { paragraph: paragraph!, offset: 99 },
          },
        },
      ],
    });
    expect(refusal(response)).toBe('invalid-offset');
  });
});

describe('UTF-16 offsets over astral and combining text', () => {
  test('a surrogate pair counts as the two code units it is', () => {
    const host = open(docx(p('a\u{1F600}b')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    expect(paragraphTexts(host, body)[0]).toHaveLength(4);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: paragraph!, offset: 1 },
            end: { paragraph: paragraph!, offset: 3 },
          },
        },
      ],
    });
    expect(textAt(response, 0)).toBe('\u{1F600}');
  });

  test('an endpoint that would cut a surrogate pair in half is refused', () => {
    const host = open(docx(p('a\u{1F600}b')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'replaceSpan',
          span: {
            start: { paragraph: paragraph!, offset: 1 },
            end: { paragraph: paragraph!, offset: 2 },
          },
          text: '',
        },
      ],
    });
    expect(response.ok).toBe(false);
    expect(paragraphTexts(host, body)[0]).toBe('a\u{1F600}b');
  });

  test('a combining mark is its own code unit, and a span may end between base and mark', () => {
    const host = open(docx(p('e\u0301x')));
    const { body } = roots(host);
    const [paragraph] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getSpanText',
          span: {
            start: { paragraph: paragraph!, offset: 0 },
            end: { paragraph: paragraph!, offset: 1 },
          },
        },
      ],
    });
    expect(textAt(response, 0)).toBe('e');
  });
});

describe('searching a story', () => {
  test('finds every occurrence, in reading order, as spans', () => {
    const host = open(docx(`${p('one two one')}${p('one')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const response = host.execute({ operations: [{ op: 'search', body, text: 'one' }] });
    const spans = spansAt(response, 0);
    expect(spans).toEqual([
      { start: { paragraph: list[0]!, offset: 0 }, end: { paragraph: list[0]!, offset: 3 } },
      { start: { paragraph: list[0]!, offset: 8 }, end: { paragraph: list[0]!, offset: 11 } },
      { start: { paragraph: list[1]!, offset: 0 }, end: { paragraph: list[1]!, offset: 3 } },
    ]);
  });

  test('finds text inside a table cell, because those paragraphs are in the story', () => {
    const host = open(docx(`${p('head')}${table(row(cell(p('needle'))))}`));
    const { body } = roots(host);
    const response = host.execute({ operations: [{ op: 'search', body, text: 'needle' }] });
    expect(spansAt(response, 0)).toHaveLength(1);
  });

  test('is case-insensitive by default and case-sensitive when asked', () => {
    const host = open(docx(p('Alpha alpha')));
    const { body } = roots(host);
    expect(spansAt(host.execute({ operations: [{ op: 'search', body, text: 'alpha' }] }), 0))
      .toHaveLength(2);
    expect(
      spansAt(
        host.execute({
          operations: [{ op: 'search', body, text: 'alpha', options: { matchCase: true } }],
        }),
        0
      )
    ).toHaveLength(1);
  });

  test('matches whole words only when asked', () => {
    const host = open(docx(p('cat category')));
    const { body } = roots(host);
    expect(
      spansAt(
        host.execute({
          operations: [{ op: 'search', body, text: 'cat', options: { matchWholeWord: true } }],
        }),
        0
      )
    ).toHaveLength(1);
  });

  test('counts repeated text without overlapping', () => {
    const host = open(docx(p('aaaa')));
    const { body } = roots(host);
    expect(spansAt(host.execute({ operations: [{ op: 'search', body, text: 'aa' }] }), 0))
      .toHaveLength(2);
  });

  test('stops at the result cap instead of allocating one entry per character', () => {
    const host = open(docx(p('x'.repeat(5000))));
    const { body } = roots(host);
    const spans = spansAt(host.execute({ operations: [{ op: 'search', body, text: 'x' }] }), 0);
    expect(spans.length).toBeLessThanOrEqual(2000);
    expect(spans.length).toBe(2000);
  });

  test('refuses an over-long query rather than scanning it', () => {
    const host = open(docx(p('alpha')));
    const { body } = roots(host);
    const response = host.execute({
      operations: [{ op: 'search', body, text: 'x'.repeat(257) }],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('refuses empty search text rather than answering that it is everywhere', () => {
    const host = open(docx(p('alpha')));
    const { body } = roots(host);
    const response = host.execute({ operations: [{ op: 'search', body, text: '' }] });
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('refuses a search option it cannot honour instead of ignoring it', () => {
    const host = open(docx(p('alpha')));
    const { body } = roots(host);
    for (const option of ['matchWildcards', 'ignorePunct', 'ignoreSpace'] as const) {
      const response = host.execute({
        operations: [{ op: 'search', body, text: 'alpha', options: { [option]: true } }],
      });
      expect(refusal(response)).toBe('unsupported-capability');
    }
  });

  test('a span a search returned reads back as the text that was searched for', () => {
    const host = open(docx(p('find me here')));
    const { body } = roots(host);
    const found = spansAt(host.execute({ operations: [{ op: 'search', body, text: 'me' }] }), 0);
    const response = host.execute({ operations: [{ op: 'getSpanText', span: found[0]! }] });
    expect(textAt(response, 0)).toBe('me');
  });
});

describe('a handle the document no longer has', () => {
  test('is refused rather than answered with plausible empty text', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    const response = host.execute({ operations: [{ op: 'getText', target: list[0]! }] });
    expect(refusal(response)).toBe('invalid-handle');
  });

  test('cannot be written to either', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    const response = host.execute({
      operations: [{ op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: 'X' }],
    });
    expect(refusal(response)).toBe('invalid-handle');
    expect(paragraphTexts(host, body)).toEqual(['beta']);
  });

  test('a span whose paragraph is gone is refused as a whole', () => {
    const host = open(docx(`${p('alpha')}${p('beta')}`));
    const { body } = roots(host);
    const list = paragraphsOf(host, body);
    const span = spanAt(
      host.execute({
        operations: [{ op: 'insertText', at: { paragraph: list[0]!, offset: 0 }, text: '' }],
      }),
      0
    );
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: list[0]! }] });
    expect(refusal(host.execute({ operations: [{ op: 'getSpanText', span }] }))).toBe(
      'invalid-handle'
    );
  });
});
