import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_HYPHENATION_SETTINGS,
  readOoxmlPart,
  serializeOoxmlPart,
  type DocumentHyphenationSettings,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
import { breakParagraph } from '../paragraph-flow.ts';
import { opensWordAfter, wordBoundaries } from '../paragraph-word-boundaries.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const measurer = createFixedMeasurer(6, 14);
const ON: DocumentHyphenationSettings = Object.freeze({
  autoHyphenation: true,
  hyphenationZonePt: 18,
  doNotHyphenateCaps: false,
  consecutiveHyphenLimit: null,
});

function paragraph(body: string): OoxmlNode {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  const found = result.part.root.children[0]!.children.find((child) => child.kind === 'paragraph');
  if (!found) throw new Error('no paragraph');
  return found;
}

const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;

const ruRun = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/><w:lang w:val="ru-RU"/></w:rPr>` +
  `<w:t xml:space="preserve">${text}</w:t></w:r>`;

const slicesOf = (text: string, templatePunct = false): string[] => {
  const out: string[] = [];
  let consumed = 0;
  for (const boundary of wordBoundaries(text, templatePunct)) {
    const slice = text.slice(consumed, boundary);
    if (slice.length > 0) out.push(slice);
    consumed = boundary;
  }
  return out;
};

function breakLines(body: string, width: number, settings: DocumentHyphenationSettings = ON) {
  return breakParagraph(
    paragraph(body),
    'p',
    0,
    width,
    measurer,
    undefined,
    null,
    [],
    undefined,
    undefined,
    undefined,
    { hyphenationSettings: settings }
  );
}

const textsOf = (body: string, width: number, settings: DocumentHyphenationSettings = ON) =>
  breakLines(body, width, settings).map((line) => line.spans.map((span) => span.text).join(''));

describe('wordBoundaries', () => {
  test('a Form025U token keeps one cut when auto-hyphenation is off', () => {
    const text = '{d.patient.documents[0].citizenship}';
    expect(slicesOf(text)).toEqual([text]);
    expect(slicesOf(text, true)).toEqual([
      '{',
      'd.',
      'patient.',
      'documents[',
      '0]',
      '.',
      'citizenship}',
    ]);
    expect(slicesOf(text, true).join('')).toBe(text);
  });

  test('a Russian address token splits after = and quotes, then at spaces', () => {
    const text = "{d.patient.addresses[addressType='Постоянное место жительства'].region}";
    expect(slicesOf(text)).toEqual([
      "{d.patient.addresses[addressType='Постоянное ",
      'место ',
      "жительства'].region}",
    ]);
    expect(slicesOf(text, true)).toEqual([
      '{',
      'd.',
      'patient.',
      'addresses[',
      'addressType=',
      "'",
      'Постоянное ',
      'место ',
      "жительства'",
      ']',
      '.',
      'region}',
    ]);
    expect(slicesOf(text, true).join('')).toBe(text);
  });

  test('spaces, tabs, dashes, and U+2011 keep their old cuts', () => {
    expect(slicesOf('hello world')).toEqual(['hello ', 'world']);
    expect(slicesOf('aa\tbb')).toEqual(['aa', '\t', 'bb']);
    expect(slicesOf('aaaa-bbbb')).toEqual(['aaaa-', 'bbbb']);
    expect(slicesOf('aaaa‑bbbb')).toEqual(['aaaa‑bbbb']);
    expect(slicesOf('a--b')).toEqual(['a--', 'b']);
  });

  test('ordinary punctuation does not invent extra cuts', () => {
    expect(slicesOf("don't")).toEqual(["don't"]);
    expect(slicesOf('aaaa,bbbb')).toEqual(['aaaa,bbbb']);
    expect(slicesOf('end. Next')).toEqual(['end. ', 'Next']);
  });
});

describe('opensWordAfter', () => {
  test('a dash always opens the next run; a template mark does so only when enabled', () => {
    expect(opensWordAfter('aaaa-', 'bbbb')).toBe(true);
    expect(opensWordAfter('patient.', 'documents')).toBe(false);
    expect(opensWordAfter('patient.', 'documents', true)).toBe(true);
    expect(opensWordAfter("type='", 'Постоянное', true)).toBe(true);
    expect(opensWordAfter("don'", 't', true)).toBe(false);
    expect(opensWordAfter('aaaa‑', 'bbbb')).toBe(false);
  });
});

describe('template expressions in paragraph flow', () => {
  test('the same token keeps a legacy wrap when auto-hyphenation is off', () => {
    const token = '{d.patient.documents[0].citizenship}';
    const body = `<w:p>${run(token)}</w:p>`;
    const off = textsOf(body, 72, DEFAULT_HYPHENATION_SETTINGS);
    const on = textsOf(body, 72, ON);
    expect(off[0]?.startsWith('{d.patient.d')).toBe(true);
    expect(off.join('')).toBe(token);
    expect(on[0]).toBe('{d.pa');
    expect(on.join('')).toBe(token);
  });

  test('{d.patient.documents[0].citizenship} hyphenates a uniform mixed token before punctuation', () => {
    const body = `<w:p>${run('{d.patient.documents[0].citizenship}')}</w:p>`;
    const texts = textsOf(body, 72);
    expect(texts[0]).toBe('{d.pa');
    expect(texts.join('')).toBe('{d.patient.documents[0].citizenship}');
  });

  test('a fitting Russian address token may still wrap after = and quotes', () => {
    const text = "{d.patient.addresses[addressType='Постоянное место жительства'].region}";
    const body = `<w:p>${ruRun(text)}</w:p>`;
    const texts = textsOf(body, 300);
    expect(texts.join('')).toBe(text);
    expect(texts.join('')).toContain('Постоянное');
    expect(
      texts.some((line) => line.includes('=') || line.includes("'") || line.includes('['))
    ).toBe(true);
    expect(texts.some((line) => line.includes('место'))).toBe(true);
  });

  test('citizenship may still hyphenate after a punctuation wrap', () => {
    const body = `<w:p>${run('{d.patient.documents[0].citizenship}')}</w:p>`;
    const lines = breakLines(body, 54);
    expect(lines.some((line) => line.spans.some((span) => span.discretionaryHyphen))).toBe(true);
    expect(textsOf(body, 54).join('')).toBe('{d.patient.documents[0].citizenship}');
  });

  test('serialization keeps the model token and never writes U+00AD', () => {
    const xml =
      `<w:document xmlns:w="${W}"><w:body><w:p>` +
      `${run('{d.patient.documents[0].citizenship}')}` +
      `</w:p></w:body></w:document>`;
    const loaded = readOoxmlPart(xml, { name: '/word/document.xml', contentType: 'app/xml' });
    if (!loaded.ok) throw new Error(loaded.reason);
    const para = loaded.part.root.children[0]!.children.find(
      (child) => child.kind === 'paragraph'
    )!;
    breakParagraph(
      para,
      'p',
      0,
      54,
      measurer,
      undefined,
      null,
      [],
      undefined,
      undefined,
      undefined,
      {
        hyphenationSettings: ON,
      }
    );
    const saved = serializeOoxmlPart(loaded.part);
    expect(saved).toContain('{d.patient.documents[0].citizenship}');
    expect(saved).not.toContain('\u00AD');
  });

  test('an apostrophe word and a comma stay whole', () => {
    expect(textsOf(`<w:p>${run("xx don't")}</w:p>`, 42)).toEqual(['xx ', "don't"]);
    expect(textsOf(`<w:p>${run('aaaa,bbbb')}</w:p>`, 36, DEFAULT_HYPHENATION_SETTINGS)[0]).not.toBe(
      'aaaa,'
    );
  });

  test('a dash wrap and a non-breaking hyphen keep their old behavior', () => {
    expect(textsOf(`<w:p>${run('aaaa-bbbb')}</w:p>`, 36, DEFAULT_HYPHENATION_SETTINGS)).toEqual([
      'aaaa-',
      'bbbb',
    ]);
    const glued = textsOf(`<w:p>${run('aaaa‑bbbb')}</w:p>`, 36, DEFAULT_HYPHENATION_SETTINGS);
    expect(glued[0]).not.toBe('aaaa‑');
  });
});
