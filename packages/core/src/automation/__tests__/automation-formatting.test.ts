// Formatting through the protocol: what a range agrees about, and what a write authors.
//
// TWO CLAIMS, and they are different claims. Reading formatting over a stretch of a story is a
// question about AGREEMENT — every run the range covers says bold, or they do not agree and the
// answer is "no agreed value". Writing formatting is a question about the ACCEPTED PROPERTY
// BOUNDARY: an op may author `w:b`, `w:i`, `w:rFonts`, `w:sz` and `w:color`, and anything else
// is refused rather than written as something adjacent.
//
// WHAT IS READ IS WHAT THE PARAGRAPH AUTHORS, never the cascade. A heading whose bold comes from
// `styles.xml` reads `null` here, and that is deliberate: the value a write merges against is the
// direct one, so echoing the cascade would let a formatting read hand back a value that a
// formatting write would then freeze into the document as if the author had chosen it.

import { describe, expect, test } from 'bun:test';
import {
  docx,
  open,
  p,
  paragraphsOf,
  refusal,
  reopen,
  roots,
  savedMainXml,
} from './support/protocol.ts';
import type { AutomationHandle, AutomationHost } from '../protocol.ts';

/** A run carrying its own `w:rPr`, so a fixture can disagree with itself. */
const run = (text: string, properties: string): string =>
  `<w:r><w:rPr>${properties}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

const BOLD_THEN_PLAIN = docx(
  `<w:p>${run('bold', '<w:b/>')}${run('plain', '')}</w:p>` +
    `<w:p>${run('all bold', '<w:b/>')}</w:p>`
);

/** Two runs with DIFFERENT faces, so a write that homogenised the range would show. */
const MIXED_FACES = docx(
  `<w:p>${run('serif', '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/>')}` +
    `${run('mono', '<w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/>')}</w:p>`
);

const FORMATTED = docx(
  `<w:p>${run('sized', '<w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="28"/><w:color w:val="FF0000"/><w:b/><w:i/>')}</w:p>`
);

const SPACED = docx(
  '<w:p><w:pPr><w:jc w:val="center"/>' +
    '<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>' +
    '<w:ind w:left="720" w:right="360" w:firstLine="240"/>' +
    '<w:widowControl w:val="0"/></w:pPr>' +
    '<w:r><w:t>spaced</w:t></w:r></w:p>' +
    p('plain')
);

function fontOf(host: AutomationHost, paragraph: AutomationHandle) {
  const response = host.execute({ operations: [{ op: 'getFont', span: { paragraph } }] });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'font') {
    throw new Error(`expected a font: ${JSON.stringify(response.results[0])}`);
  }
  return result.value.font;
}

function formatOf(host: AutomationHost, paragraph: AutomationHandle) {
  const response = host.execute({
    operations: [{ op: 'getParagraphFormat', paragraph: { paragraph } }],
  });
  const result = response.results[0];
  if (result?.status !== 'ok' || result.value.kind !== 'paragraphFormat') {
    throw new Error(`expected a paragraph format: ${JSON.stringify(response.results[0])}`);
  }
  return result.value.format;
}

describe('reading a font over a range', () => {
  test('answers the value every run agrees on', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [, uniform] = paragraphsOf(host, body);
    expect(fontOf(host, uniform!).bold).toBe(true);
  });

  test('answers no agreed value where the runs disagree', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [mixed] = paragraphsOf(host, body);
    expect(fontOf(host, mixed!).bold).toBe(null);
  });

  test('answers no agreed value where nothing authors the property at all', () => {
    // NOT `false`. A paragraph that authors no `w:b` may still be bold through its style, and a
    // read that said `false` would be a claim about the cascade this lane does not resolve.
    const host = open(docx(p('plain')));
    const body = roots(host).body;
    const [only] = paragraphsOf(host, body);
    expect(fontOf(host, only!)).toEqual({
      bold: null,
      italic: null,
      name: null,
      size: null,
      color: null,
    });
  });

  test('reads name, size in points and colour as a hex triplet', () => {
    const host = open(FORMATTED);
    const body = roots(host).body;
    const [only] = paragraphsOf(host, body);
    expect(fontOf(host, only!)).toEqual({
      bold: true,
      italic: true,
      name: 'Georgia',
      size: 14,
      color: '#FF0000',
    });
  });

  test('narrows to the characters asked about, so one run of two can agree', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [mixed] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'getFont',
          span: {
            start: { paragraph: mixed!, offset: 0 },
            end: { paragraph: mixed!, offset: 4 },
          },
        },
      ],
    });
    const result = response.results[0];
    if (result?.status !== 'ok' || result.value.kind !== 'font') throw new Error('no font');
    expect(result.value.font.bold).toBe(true);
  });
});

describe('writing a font', () => {
  test('authors the properties and they survive save and reopen', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'setFont',
          span: { paragraph: first! },
          font: { bold: true, italic: true, name: 'Georgia', size: 11, color: '#0000FF' },
        },
      ],
    });
    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });

    const next = reopen(host);
    const [again] = paragraphsOf(next.host, next.body);
    expect(fontOf(next.host, again!)).toEqual({
      bold: true,
      italic: true,
      name: 'Georgia',
      size: 11,
      color: '#0000FF',
    });
  });

  test('keeps the paragraph mark in step, so a list bullet takes the same face', () => {
    // Word applies whole-paragraph formatting to the pilcrow too; the marker inherits from it.
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    host.execute({
      operations: [{ op: 'setFont', span: { paragraph: first! }, font: { bold: true } }],
    });
    expect(savedMainXml(host)).toContain('<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>');
  });

  test('leaves each run its own other formatting instead of homogenising the range', () => {
    // The op REPLACES the properties container it writes, so a size change carrying one bag over
    // a mixed range rewrites every run with the first run's font. Both runs keep their own face.
    const host = open(MIXED_FACES);
    const body = roots(host).body;
    const [mixed] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'setFont', span: { paragraph: mixed! }, font: { size: 20 } }],
    });
    expect(response.ok).toBe(true);
    const xml = savedMainXml(host);
    expect(xml).toContain('w:ascii="Georgia"');
    expect(xml).toContain('w:ascii="Courier New"');

    const next = reopen(host);
    const [again] = paragraphsOf(next.host, next.body);
    // The size is agreed because both runs got it; the name is not, because neither lost its own.
    expect(fontOf(next.host, again!)).toEqual({
      bold: null,
      italic: null,
      name: null,
      size: 20,
      color: null,
    });
  });

  test('clears a property when it is asked for as false', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [, uniform] = paragraphsOf(host, body);
    host.execute({
      operations: [{ op: 'setFont', span: { paragraph: uniform! }, font: { bold: false } }],
    });
    const next = reopen(host);
    const [, again] = paragraphsOf(next.host, next.body);
    expect(fontOf(next.host, again!).bold).toBe(false);
  });

  test('refuses a colour that is not a hex triplet, naming the field', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'setFont', span: { paragraph: first! }, font: { color: 'red' } }],
    });
    expect(refusal(response)).toBe('unsupported-content');
    expect(response.changed).toBe(false);
  });

  test('refuses a size that is not a positive number of points', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    for (const size of [0, -1, 2000, Number.NaN]) {
      const response = host.execute({
        operations: [{ op: 'setFont', span: { paragraph: first! }, font: { size } }],
      });
      expect(refusal(response)).toBe('unsupported-content');
    }
  });

  test('refuses a font name carrying a character XML cannot hold', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'setFont', span: { paragraph: first! }, font: { name: 'Bad\u0000Name' } }],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('refuses a write with no field in it, rather than committing nothing as a change', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [{ op: 'setFont', span: { paragraph: first! }, font: {} }],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('escapes an attacker-shaped font name on save rather than templating it', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    host.execute({
      operations: [{ op: 'setFont', span: { paragraph: first! }, font: { name: 'A" onload="x' } }],
    });
    const xml = savedMainXml(host);
    expect(xml).toContain('&quot;');
    expect(xml).not.toContain('onload="x"');
  });
});

describe('reading a paragraph format', () => {
  test('answers alignment, indents and spacing in points', () => {
    const host = open(SPACED);
    const body = roots(host).body;
    const [spaced] = paragraphsOf(host, body);
    expect(formatOf(host, spaced!)).toEqual({
      alignment: 'Centered',
      style: null,
      firstLineIndent: 12,
      leftIndent: 36,
      rightIndent: 18,
      lineSpacing: 18,
      spaceBefore: 12,
      spaceAfter: 6,
      widowControl: false,
    });
  });

  test('answers Unknown and no agreed value for a paragraph that authors none', () => {
    const host = open(SPACED);
    const body = roots(host).body;
    const [, plain] = paragraphsOf(host, body);
    expect(formatOf(host, plain!)).toEqual({
      alignment: 'Unknown',
      style: null,
      firstLineIndent: null,
      leftIndent: null,
      rightIndent: null,
      lineSpacing: null,
      spaceBefore: null,
      spaceAfter: null,
      widowControl: null,
    });
  });
});

describe('writing a paragraph format', () => {
  test('authors what was asked for and leaves the rest of the properties alone', () => {
    const host = open(SPACED);
    const body = roots(host).body;
    const [spaced] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'setParagraphFormat',
          paragraph: { paragraph: spaced! },
          format: { alignment: 'Right', leftIndent: 18 },
        },
      ],
    });
    expect(response.ok).toBe(true);

    const next = reopen(host);
    const [again] = paragraphsOf(next.host, next.body);
    expect(formatOf(next.host, again!)).toEqual({
      alignment: 'Right',
      style: null,
      firstLineIndent: 12,
      leftIndent: 18,
      rightIndent: 18,
      lineSpacing: 18,
      spaceBefore: 12,
      spaceAfter: 6,
      widowControl: false,
    });
  });

  test('refuses an alignment this API does not have', () => {
    const host = open(SPACED);
    const body = roots(host).body;
    const [spaced] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'setParagraphFormat',
          paragraph: { paragraph: spaced! },
          // Declared by upstream as a READ value — a paragraph either agrees or it does not —
          // and meaningless as a write.
          format: { alignment: 'Mixed' },
        },
      ],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });

  test('refuses an indent outside the range OOXML can express', () => {
    const host = open(SPACED);
    const body = roots(host).body;
    const [spaced] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        {
          op: 'setParagraphFormat',
          paragraph: { paragraph: spaced! },
          format: { leftIndent: 1e9 },
        },
      ],
    });
    expect(refusal(response)).toBe('unsupported-content');
  });
});

describe('formatting and the rest of a batch', () => {
  test('two writes to the SAME property container are refused as conflicting', () => {
    // Both were planned from the tree as it was before the batch, so the second would carry a
    // container the first had already replaced — the caller would have asked for two things and
    // silently got one.
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    for (const operations of [
      [
        { op: 'setFont', span: { paragraph: first! }, font: { bold: true } },
        { op: 'setFont', span: { paragraph: first! }, font: { italic: true } },
      ],
      [
        { op: 'setParagraphFormat', paragraph: { paragraph: first! }, format: { leftIndent: 18 } },
        { op: 'setParagraphFormat', paragraph: { paragraph: first! }, format: { spaceAfter: 6 } },
      ],
    ] as const) {
      const response = host.execute({ operations: [...operations] });
      expect(refusal(response)).toBe('conflicting-operations');
      expect(response.changed).toBe(false);
    }
  });

  test('a font write and a paragraph-format write on one paragraph are one batch, and both land', () => {
    // They touch containers the other one keeps as authored: the run/mark properties a font write
    // rewrites are exactly what a paragraph-property write preserves, and the other way round. So
    // the ordinary shape of a formatting script is not two syncs.
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'setFont', span: { paragraph: first! }, font: { italic: true } },
        { op: 'setParagraphFormat', paragraph: { paragraph: first! }, format: { leftIndent: 18 } },
      ],
    });
    expect({ ok: response.ok, changed: response.changed }).toEqual({ ok: true, changed: true });

    const next = reopen(host);
    const [again] = paragraphsOf(next.host, next.body);
    expect(fontOf(next.host, again!).italic).toBe(true);
    expect(formatOf(next.host, again!).leftIndent).toBe(18);
  });

  test('a formatting write and a structural edit of the same paragraph are refused', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    const response = host.execute({
      operations: [
        { op: 'deleteParagraph', paragraph: first! },
        { op: 'setFont', span: { paragraph: first! }, font: { bold: true } },
      ],
    });
    expect(refusal(response)).toBe('conflicting-operations');
  });

  test('a stale paragraph handle is refused rather than retargeted', () => {
    const host = open(BOLD_THEN_PLAIN);
    const body = roots(host).body;
    const [first] = paragraphsOf(host, body);
    host.execute({ operations: [{ op: 'deleteParagraph', paragraph: first! }] });
    const response = host.execute({
      operations: [{ op: 'setFont', span: { paragraph: first! }, font: { bold: true } }],
    });
    expect(refusal(response)).toBe('invalid-handle');
  });
});
