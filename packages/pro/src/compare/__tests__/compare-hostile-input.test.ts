/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Inputs shaped to confuse the compare's own bookkeeping: text that looks like its internal
// markers, ids past the safe integer range, very long paragraphs, missing definition parts,
// and notes the revised document lists out of reference order.
import { expect, test } from 'bun:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { W_NS, buildDocx } from '../../../../../scripts/compare-corpus/docx-builder.ts';
import { listPr, p, pRaw, r, textBox } from '../../../../../scripts/compare-corpus/xml.ts';
import { compareDocuments } from '../index.ts';

const DATE = new Date('2026-01-10T12:00:00Z');
const compare = (base: Uint8Array, revised: Uint8Array) =>
  compareDocuments(base, revised, { authorName: 'Test', date: DATE });

function files(base: Uint8Array, revised: Uint8Array): Record<string, string> {
  const result = compare(base, revised);
  if (!result.ok) throw new Error(result.message);
  const text: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(unzipSync(result.bytes)))
    text[name] = strFromU8(bytes);
  return text;
}

const HUGE = '9007199254740992';
const commented = (id: number | string, text: string) =>
  `<w:p><w:commentRangeStart w:id="${id}"/>${r(text)}<w:commentRangeEnd w:id="${id}"/>` +
  `<w:r><w:commentReference w:id="${id}"/></w:r></w:p>`;
const commentIds = (xml: string) =>
  [...xml.matchAll(/<w:comment\b[^>]*w:id="([^"]*)"/g)].map((match) => match[1]);

test('text that looks like an internal marker stays as written', () => {
  const tooltip = 'see §CMT:7§ and §NEW:/word/x.xml§ here';
  const link = `<w:p><w:hyperlink w:anchor="x" w:tooltip="${tooltip}"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>`;
  const out = files(buildDocx({ body: link + p('one') }), buildDocx({ body: link + p('two') }));
  expect(out['word/document.xml']).toContain(`w:tooltip="${tooltip}"`);
  const text = p('Price §CMT:1§ total §REL:/word/document.xml|rId1§');
  const result = compare(
    buildDocx({ body: text + p('one') }),
    buildDocx({ body: text + p('two') })
  );
  if (!result.ok) throw new Error(result.message);
  const document = strFromU8(unzipSync(result.bytes)['word/document.xml']!);
  expect(document).toContain('Price §CMT:1§ total §REL:/word/document.xml|rId1§');
});

test('a new comment never repeats an id past the safe integer range', () => {
  const base = buildDocx({
    body: commented(HUGE, 'Alpha'),
    comments: [{ id: HUGE as unknown as number, author: 'A', text: 'old' }],
  });
  const revised = buildDocx({
    body: commented(HUGE, 'Alpha') + commented(1, 'Beta'),
    comments: [
      { id: HUGE as unknown as number, author: 'A', text: 'old' },
      { id: 1, author: 'B', text: 'new' },
    ],
  });
  const ids = commentIds(files(base, revised)['word/comments.xml']!);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain(HUGE);
  // The shared comment appears at both anchors, and the new one is added.
  expect(ids.length).toBe(3);
});

test('a new note after a note id past the safe integer range gets its own id', () => {
  const reference = (id: string, text: string) =>
    `<w:p>${r(text)}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>` +
    `<w:footnoteReference w:id="${id}"/></w:r></w:p>`;
  const notes = { [HUGE]: p('Old note') } as unknown as Record<number, string>;
  const base = buildDocx({ body: reference(HUGE, 'Alpha'), footnotes: notes });
  // The revised notes part lists the new note first, before the note it references first.
  const revised = buildDocx({
    body: reference(HUGE, 'Alpha') + reference('1', 'Beta'),
    footnotes: { ...notes, 1: p('New note') },
  });
  const out = files(base, revised);
  const ids = [...out['word/footnotes.xml']!.matchAll(/<w:footnote\b[^>]*w:id="([^"]*)"/g)].map(
    (match) => match[1]
  );
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toContain(HUGE);
});

test('a very long paragraph returns a result instead of throwing', () => {
  const base = buildDocx({ body: p('x') });
  const revised = buildDocx({ body: p('.'.repeat(1_200_000)) });
  expect(() => compare(base, revised)).not.toThrow();
});

const level =
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>';
const numbering = `<w:numbering xmlns:w="${W_NS}"><w:abstractNum w:abstractNumId="0">${level}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
const noNumbering = (docx: Uint8Array) => {
  const zip = unzipSync(docx);
  delete zip['word/numbering.xml'];
  return zip;
};

test('a revised list reference with no revised definition numbers nothing', () => {
  const base = buildDocx({ body: p('plain', listPr(1)) + p('tail'), numbering });
  const revised = noNumbering(buildDocx({ body: p('plain', listPr(1)) + p('tail changed') }));
  revised['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(revised['word/_rels/document.xml.rels']!).replace(
      /<Relationship [^>]*Target="numbering.xml"\/>/,
      ''
    )
  );
  const out = files(base, zipSync(revised, { mtime: new Date(2026, 0, 1) }));
  const paragraph = /<w:p\b(?:(?!<\/w:p>).)*plain(?:(?!<\/w:p>).)*<\/w:p>/s.exec(
    out['word/document.xml']!
  )![0];
  const current = paragraph.replace(/<w:pPrChange\b[\s\S]*?<\/w:pPrChange>/, '');
  expect(current).toContain('<w:numId w:val="0"/>');
});

test('an original list reference with no original definition keeps numbering nothing', () => {
  const base = noNumbering(buildDocx({ body: p('kept', listPr(1)) + p('tail') }));
  base['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(base['word/_rels/document.xml.rels']!).replace(
      /<Relationship [^>]*Target="numbering.xml"\/>/,
      ''
    )
  );
  const revised = buildDocx({ body: p('kept', listPr(1)) + p('tail changed'), numbering });
  const out = files(zipSync(base, { mtime: new Date(2026, 0, 1) }), revised);
  const list = Object.entries(out).find(([name]) => /^word\/numbering\d*\.xml$/.test(name))?.[1];
  // The revised list is added under a new id; the original's reference is kept for reject.
  expect(list).toBeDefined();
  expect(list).not.toMatch(/w:numId="1"/);
  const paragraph = /<w:p\b(?:(?!<\/w:p>).)*kept(?:(?!<\/w:p>).)*<\/w:p>/s.exec(
    out['word/document.xml']!
  )![0];
  expect(paragraph).toMatch(/<w:pPrChange\b[\s\S]*<w:numId w:val="1"\/>/);
});

test('new notes, comments, and list definitions avoid ids the original names but lacks', () => {
  const note = (text: string, id: number) =>
    `<w:p>${r(text)}<w:r><w:footnoteReference w:id="${id}"/></w:r></w:p>`;
  const noteOut = files(
    buildDocx({ body: note('Alpha', 1) + note('Dangling', 2), footnotes: { 1: p('one') } }),
    buildDocx({
      body: note('Alpha', 1) + note('Dangling', 2) + note('New', 3),
      footnotes: { 1: p('one'), 3: p('revised note') },
    })
  );
  const noteIds = [...noteOut['word/footnotes.xml']!.matchAll(/<w:footnote\b[^>]*w:id="(\d+)"/g)];
  expect(noteIds.map((match) => match[1])).not.toContain('2');

  const dangling =
    `<w:p><w:commentRangeStart w:id="0"/>${r('Kept')}<w:commentRangeEnd w:id="0"/>` +
    '<w:r><w:commentReference w:id="0"/></w:r></w:p>';
  const commentOut = files(
    buildDocx({ body: dangling + p('tail') }),
    buildDocx({
      body: p('Kept') + commented(5, 'tail'),
      comments: [{ id: 5, author: 'R', text: 'revised comment' }],
    })
  );
  expect(commentIds(commentOut['word/comments.xml']!)).not.toContain('0');

  // The original's list 2 names definition 1, which it does not hold.
  const orphan = '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
  const listOut = files(
    buildDocx({
      body: p('orphan item', listPr(2)) + p('tail'),
      numbering: numbering.replace('</w:numbering>', `${orphan}</w:numbering>`),
    }),
    buildDocx({
      body: p('orphan item') + p('new item', listPr(1)),
      numbering: numbering.replace('decimal', 'upperRoman'),
    })
  );
  const definitions = [
    ...listOut['word/numbering.xml']!.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"/g),
  ].map((match) => match[1]);
  expect(definitions).not.toContain('1');
});

test('many deleted paragraphs compare in linear time, and the limit counts every story', () => {
  const one = buildDocx({ body: p('a') });
  const time = (doc: Uint8Array) => {
    const started = performance.now();
    expect(compare(doc, one).ok).toBe(true);
    return performance.now() - started;
  };
  const small = buildDocx({ body: p('a').repeat(2000) });
  time(small);
  const first = time(small);
  const second = time(buildDocx({ body: p('a').repeat(8000) }));
  // Four times the paragraphs: about four times the time when linear, sixteen when quadratic.
  expect(second / Math.max(first, 1)).toBeLessThan(8);
  // The bound counts notes too, and refuses before any revision is accepted.
  const notes: Record<number, string> = {};
  for (let id = 1; id <= 60_000; id++) notes[id] = '';
  const result = compare(
    buildDocx({ body: p('x'), footnotes: notes }),
    buildDocx({ body: p('y'), footnotes: notes })
  );
  expect(result.ok ? '' : result.code).toBe('tooLarge');
  // Shared CI runners run this several times slower than a workstation, so the runner's
  // 5 s default fails there. The ratio above is the real assertion.
}, 60_000);

test('the limit counts a main story of any declared type and text box content', () => {
  const macroEnabled = (docx: Uint8Array) => {
    const zip = unzipSync(docx);
    zip['[Content_Types].xml'] = strToU8(
      strFromU8(zip['[Content_Types].xml']!).replace(
        /(PartName="\/word\/document\.xml" ContentType=")[^"]+"/,
        '$1application/vnd.ms-word.document.macroEnabled.main+xml"'
      )
    );
    return zipSync(zip, { mtime: new Date(2026, 0, 1) });
  };
  const body = p('a').repeat(60_000);
  const typed = compare(macroEnabled(buildDocx({ body })), macroEnabled(buildDocx({ body })));
  expect(typed.ok ? '' : typed.code).toBe('tooLarge');
  // A small document of that type compares, its main story checked like any other.
  const small = compare(
    macroEnabled(buildDocx({ body: p('one two') })),
    macroEnabled(buildDocx({ body: p('one three') }))
  );
  expect(small.ok && small.revisionCount).toBeGreaterThan(0);
  const boxed = buildDocx({ body: pRaw(textBox(body, 1)) + p('tail') });
  const inBoxes = compare(boxed, boxed);
  expect(inBoxes.ok ? '' : inBoxes.code).toBe('tooLarge');
});

test('notes, styles, lists, and comments are found through relationships, not part types', () => {
  const WML = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  // Unrelated copies with the right content types, listed before the related parts.
  const withDecoys = (docx: Uint8Array, comments = false) => {
    const zip = unzipSync(docx);
    const out: Record<string, Uint8Array> = {};
    const decoys: Record<string, [string, string]> = {
      'word/a.xml': ['word/footnotes.xml', 'footnotes'],
      'word/b.xml': ['word/styles.xml', 'styles'],
      'word/c.xml': ['word/numbering.xml', 'numbering'],
    };
    let types = strFromU8(zip['[Content_Types].xml']!);
    for (const [name, [source, kind]] of Object.entries(decoys)) {
      types = types.replace(
        '<Override ',
        `<Override PartName="/${name}" ContentType="${WML}.${kind}+xml"/><Override `
      );
      out[name] = zip[source]!;
    }
    out['[Content_Types].xml'] = strToU8(types);
    if (comments) {
      zip['word/_rels/document.xml.rels'] = strToU8(
        strFromU8(zip['word/_rels/document.xml.rels']!).replace(
          'Target="comments.xml"',
          'Target="./comments.xml"'
        )
      );
    }
    for (const [name, bytes] of Object.entries(zip)) if (!(name in out)) out[name] = bytes;
    return zipSync(out, { mtime: new Date(2026, 0, 1) });
  };
  const fancy = '<w:style w:type="paragraph" w:styleId="Fancy"><w:name w:val="Fancy"/></w:style>';
  const body = `<w:p>${r('Body')}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>`;
  const base = withDecoys(
    buildDocx({
      body: body + commented(0, 'Kept'),
      footnotes: { 1: p('Alpha note') },
      numbering,
      comments: [{ id: 0, author: 'A', text: 'base comment' }],
    }),
    true
  );
  const revised = buildDocx({
    body:
      body +
      commented(0, 'Kept') +
      p('Fancy line', '<w:pStyle w:val="Fancy"/>') +
      p('roman', listPr(1)) +
      commented(1, 'Added'),
    footnotes: { 1: p('Beta note') },
    numbering: numbering.replace('decimal', 'upperRoman'),
    extraStyles: fancy,
    comments: [
      { id: 0, author: 'A', text: 'base comment' },
      { id: 1, author: 'B', text: 'revised comment' },
    ],
  });
  const out = files(base, revised);
  expect(out['word/footnotes.xml']).toContain('Beta');
  expect(out['word/a.xml']).not.toContain('<w:ins');
  expect(out['word/styles.xml']).toContain('w:styleId="Fancy"');
  expect(out['word/b.xml']).not.toContain('Fancy');
  expect(out['word/numbering.xml']).toContain('upperRoman');
  expect(out['word/c.xml']).not.toContain('upperRoman');
  expect(Object.keys(out).filter((name) => /^word\/comments\d*\.xml$/.test(name))).toEqual([
    'word/comments.xml',
  ]);
  expect(out['word/comments.xml']).toContain('revised comment');
});

test('definitions merge into the parts the editor reads, through its fallbacks and decoding', () => {
  const mine = (color: string) =>
    '<w:style w:type="paragraph" w:customStyle="1" w:styleId="Mine"><w:name w:val="Mine"/>' +
    `<w:rPr><w:color w:val="${color}"/></w:rPr></w:style>`;
  const list = (text: string) => p(text, listPr(1));
  // No styles relationship (the reader falls back to styles.xml) and a percent-encoded
  // numbering target (the reader decodes it).
  const zip = unzipSync(
    buildDocx({
      body: p('Keep me', '<w:pStyle w:val="Mine"/>') + list('Item') + p('hello'),
      extraStyles: mine('FF0000'),
      numbering,
    })
  );
  zip['word/_rels/document.xml.rels'] = strToU8(
    strFromU8(zip['word/_rels/document.xml.rels']!)
      .replace(/<Relationship [^>]*Type="[^"]*\/styles"[^>]*\/>/, '')
      .replace('Target="numbering.xml"', 'Target="num%62ering.xml"')
  );
  const base = zipSync(zip, { mtime: new Date(2026, 0, 1) });
  const revised = buildDocx({
    body: p('Keep me', '<w:pStyle w:val="Mine"/>') + list('Item') + p('hello world'),
    extraStyles: mine('0000FF'),
    numbering,
  });
  const out = files(base, revised);
  expect(
    Object.keys(out).filter((name) => /^word\/(styles|numbering)\d+\.xml$/.test(name))
  ).toEqual([]);
  // A style both documents define takes the revised definition, in the part the editor reads.
  expect(out['word/styles.xml']).toContain('0000FF');
  expect(out['word/styles.xml']).not.toContain('FF0000');
  // The unchanged list item records no property change.
  expect(out['word/document.xml']).not.toContain('pPrChange');
});
