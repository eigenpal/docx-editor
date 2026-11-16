/** Corpus families 8-16: tables, sections, headers/footers, notes, fields, drawings, controls, review state, whole documents. */
import { solidPng, type DocSpec } from './docx-builder.ts';
import { sinkFor, type CompareCase } from './families-text.ts';
import {
  bookmark,
  commented,
  delWrap,
  endnoteRef,
  field,
  footnoteRef,
  heading,
  hyperlink,
  inlineImage,
  insWrap,
  int,
  listPr,
  p,
  paragraphText,
  pRaw,
  r,
  rDel,
  rngOf,
  rPrChange,
  sdtBlock,
  sdtRun,
  sectPr,
  sentence,
  simpleField,
  style,
  table,
  textBox,
  words,
  type CellSpec,
  type Rng,
} from './xml.ts';

const join = (texts: readonly string[], pPr = '') => texts.map((text) => p(text, pPr)).join('');
const context = (rng: Rng, count: number) =>
  Array.from({ length: count }, () => paragraphText(rng));
const cellText = (rng: Rng) => words(rng, int(rng, 1, 4)).join(' ');
const grid = (rng: Rng, rows: number, cols: number) =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => cellText(rng)));

// ---------------------------------------------------------------- 8 tables

export function tablesFamily(out: CompareCase[]): void {
  const add = sinkFor('tables', out);
  let seed = 8000;
  const pair = (name: string, make: (rng: Rng) => [string, string]) => {
    const rng = rngOf(seed++);
    const [before, after] = context(rng, 2);
    const [base, revised] = make(rng);
    add(name, p(before!) + base + p(after!), p(before!) + revised + p(after!));
  };
  pair('cell-text', (rng) => {
    const g = grid(rng, 3, 3);
    const e = g.map((row) => [...row]);
    e[1]![1] = `${e[1]![1]} amended`;
    return [table(g), table(e)];
  });
  pair('cells-text-many', (rng) => {
    const g = grid(rng, 4, 3);
    const e = g.map((row, i) => row.map((cell, j) => ((i + j) % 2 ? `${cell} revised` : cell)));
    return [table(g), table(e)];
  });
  for (const where of ['start', 'middle', 'end'] as const) {
    pair(`row-insert-${where}`, (rng) => {
      const g = grid(rng, 4, 3);
      const e = [...g];
      e.splice(where === 'start' ? 0 : where === 'end' ? 4 : 2, 0, grid(rng, 1, 3)[0]!);
      return [table(g), table(e)];
    });
    pair(`row-delete-${where}`, (rng) => {
      const g = grid(rng, 4, 3);
      const e = [...g];
      e.splice(where === 'start' ? 0 : where === 'end' ? 3 : 2, 1);
      return [table(g), table(e)];
    });
  }
  pair('rows-insert-two', (rng) => {
    const g = grid(rng, 3, 2);
    return [table(g), table([...g.slice(0, 1), ...grid(rng, 2, 2), ...g.slice(1)])];
  });
  pair('column-insert', (rng) => {
    const g = grid(rng, 3, 2);
    return [table(g), table(g.map((row) => [row[0]!, cellText(rng), row[1]!]))];
  });
  pair('column-delete', (rng) => {
    const g = grid(rng, 3, 3);
    return [table(g), table(g.map((row) => [row[0]!, row[2]!]))];
  });
  pair('grid-span-change', (rng) => {
    const g = grid(rng, 3, 3);
    const merged: Array<Array<string | CellSpec>> = g.map((row) => [...row]);
    merged[0] = [{ text: g[0]![0]!, tcPr: '<w:gridSpan w:val="2"/>' }, g[0]![2]!];
    return [table(g), table(merged, { widths: [3120, 3120, 3120] })];
  });
  pair('vmerge-change', (rng) => {
    const g = grid(rng, 3, 2);
    const merged: Array<Array<string | CellSpec>> = [
      [{ text: g[0]![0]!, tcPr: '<w:vMerge w:val="restart"/>' }, g[0]![1]!],
      [{ text: '', tcPr: '<w:vMerge/>' }, g[1]![1]!],
      [g[2]![0]!, g[2]![1]!],
    ];
    return [table(g), table(merged)];
  });
  pair('nested-table-text', (rng) => {
    const inner = grid(rng, 2, 2);
    const innerEdited = inner.map((row) => [...row]);
    innerEdited[1]![0] = `${innerEdited[1]![0]} updated`;
    const outer = (nested: string[][]) =>
      table([
        [{ text: '', raw: table(nested) + p('') }, cellText(rngOf(1))],
        ['Left cell', 'Right cell'],
      ]);
    return [outer(inner), outer(innerEdited)];
  });
  pair('table-insert', (rng) => ['', table(grid(rng, 3, 3))]);
  pair('table-delete', (rng) => [table(grid(rng, 3, 3)), '']);
  pair('table-borders', (rng) => {
    const g = grid(rng, 2, 2);
    return [
      table(g),
      table(g, {
        tblPr:
          '<w:tblBorders><w:top w:val="double" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="double" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders>',
      }),
    ];
  });
  pair('table-alignment', (rng) => {
    const g = grid(rng, 2, 2);
    return [
      table(g, { widths: [3000, 3000] }),
      table(g, { widths: [3000, 3000], tblPr: '<w:jc w:val="center"/>' }),
    ];
  });
  pair('cell-shading', (rng) => {
    const g = grid(rng, 2, 2);
    const shaded: Array<Array<string | CellSpec>> = g.map((row) => [...row]);
    shaded[0] = shaded[0]!.map((cell) => ({
      text: cell as string,
      tcPr: '<w:shd w:val="clear" w:color="auto" w:fill="D9D9D9"/>',
    }));
    return [table(g), table(shaded)];
  });
  pair('cell-widths', (rng) => {
    const g = grid(rng, 2, 3);
    return [table(g, { widths: [3120, 3120, 3120] }), table(g, { widths: [2000, 4000, 3360] })];
  });
  pair('header-row', (rng) => {
    const g = grid(rng, 3, 2);
    return [table(g), table(g, { trPr: (i) => (i === 0 ? '<w:tblHeader/>' : '') })];
  });
  pair('row-reorder', (rng) => {
    const g = grid(rng, 4, 2);
    return [table(g), table([g[0]!, g[2]!, g[1]!, g[3]!])];
  });
  pair('empty-cell-filled', (rng) => {
    const g = grid(rng, 2, 2);
    const empty = g.map((row) => [...row]);
    empty[1]![1] = '';
    return [table(empty), table(g)];
  });
  pair('table-to-paragraphs', (rng) => {
    const g = grid(rng, 2, 2);
    return [table(g), g.map((row) => p(row.join(' '))).join('')];
  });
  pair('paragraphs-to-table', (rng) => {
    const g = grid(rng, 2, 2);
    return [g.map((row) => p(row.join(' '))).join(''), table(g)];
  });
  pair('large-table-one-cell', (rng) => {
    const g = grid(rng, 20, 4);
    const e = g.map((row) => [...row]);
    e[13]![2] = `${e[13]![2]} changed`;
    return [table(g), table(e)];
  });
  pair('cell-paragraph-insert', (rng) => {
    const g = grid(rng, 2, 2);
    const extra: Array<Array<string | CellSpec>> = g.map((row) => [...row]);
    extra[0]![1] = { text: '', raw: p(g[0]![1]!) + p(sentence(rng, 3, 6)) };
    return [table(g), table(extra)];
  });
  pair('cell-list', (rng) => {
    const g = grid(rng, 2, 2);
    const listed: Array<Array<string | CellSpec>> = g.map((row) => [...row]);
    listed[1]![0] = { text: '', raw: p(g[1]![0]!, listPr(1)) + p(sentence(rng, 3, 5), listPr(1)) };
    return [table(g), table(listed)];
  });
}

// ---------------------------------------------------------------- 9 sections

export function sectionsFamily(out: CompareCase[]): void {
  const add = sinkFor('sections', out);
  let seed = 9000;
  const doc = (rng: Rng, final: string, body?: string): DocSpec => ({
    body: body ?? join(context(rng, 4)),
    sectPr: final,
  });
  const pairs: ReadonlyArray<readonly [string, string, string]> = [
    ['margins', sectPr(), sectPr({ margins: [1080, 1080, 1080, 1080] })],
    ['landscape', sectPr(), sectPr({ width: 15840, height: 12240, orient: 'landscape' })],
    ['two-columns', sectPr(), sectPr({ cols: 2 })],
    ['a4', sectPr(), sectPr({ width: 11906, height: 16838 })],
    [
      'line-numbers',
      sectPr(),
      sectPr({ extra: '<w:lnNumType w:countBy="1" w:restart="continuous"/>' }),
    ],
    ['page-number-start', sectPr(), sectPr({ extra: '<w:pgNumType w:start="5"/>' })],
    ['vertical-center', sectPr(), sectPr({ extra: '<w:vAlign w:val="center"/>' })],
  ];
  for (const [name, before, after] of pairs) {
    const rng = rngOf(seed++);
    const body = join(context(rng, 4));
    add(name, doc(rng, before, body), doc(rng, after, body));
  }
  {
    const rng = rngOf(seed++);
    const texts = context(rng, 4);
    const split =
      p(texts[0]!) + p(texts[1]!, sectPr({ type: 'nextPage' })) + p(texts[2]!) + p(texts[3]!);
    add('section-break-add', { body: join(texts) }, { body: split });
    add('section-break-remove', { body: split }, { body: join(texts) });
    const continuous =
      p(texts[0]!) +
      p(texts[1]!, sectPr({ type: 'continuous', cols: 2 })) +
      p(texts[2]!) +
      p(texts[3]!);
    add('section-break-type', { body: split }, { body: continuous });
  }
  {
    const rng = rngOf(seed++);
    const body = join(context(rng, 3));
    add(
      'margins-and-text',
      doc(rng, sectPr(), body),
      doc(rng, sectPr({ margins: [720, 720, 720, 720] }), body + p(sentence(rng)))
    );
  }
  {
    const rng = rngOf(seed++);
    const texts = context(rng, 3);
    add(
      'page-break-insert',
      join(texts),
      p(texts[0]!) + pRaw(r(texts[1]!) + '<w:r><w:br w:type="page"/></w:r>') + p(texts[2]!)
    );
  }
}

// ---------------------------------------------------------------- 10 headers and footers

export function headersFootersFamily(out: CompareCase[]): void {
  const add = sinkFor('headers-footers', out);
  let seed = 10000;
  const hp = (text: string, kind: 'Header' | 'Footer' = 'Header') => p(text, style(kind));
  const page = pRaw(r('Page ') + field('PAGE', '1'), style('Footer'));
  const make = (name: string, base: Partial<DocSpec>, revised: Partial<DocSpec>, edit = false) => {
    const rng = rngOf(seed++);
    const texts = context(rng, 3);
    const body = join(texts);
    const revisedBody = edit
      ? p(texts[0]!) + p(`${texts[1]!} ${sentence(rng)}`) + p(texts[2]!)
      : body;
    add(name, { body, ...base }, { body: revisedBody, ...revised });
  };
  const H = (text: string) => ({ default: hp(text), first: undefined, even: undefined });
  const F = (xml: string) => ({ default: xml, first: undefined, even: undefined });
  make(
    'header-text',
    { headers: H('Master Services Agreement') },
    { headers: H('Master Services Agreement (Draft 2)') }
  );
  make(
    'footer-text',
    { footers: F(hp('Confidential', 'Footer')) },
    { footers: F(hp('Strictly Confidential', 'Footer')) }
  );
  make('header-add', {}, { headers: H('Schedule A') });
  make('header-remove', { headers: H('Schedule A') }, {});
  make(
    'footer-page-field',
    { footers: F(page) },
    {
      footers: F(
        pRaw(r('Page ') + field('PAGE', '1') + r(' of ') + field('NUMPAGES', '1'), style('Footer'))
      ),
    }
  );
  make(
    'first-page-header-add',
    { headers: H('Running Header') },
    { headers: { default: hp('Running Header'), first: hp('Cover Page Header'), even: undefined } }
  );
  make(
    'even-header-add',
    { headers: H('Odd Header') },
    {
      headers: { default: hp('Odd Header'), first: undefined, even: hp('Even Header') },
      settings: '<w:evenAndOddHeaders/>',
    }
  );
  make(
    'header-table',
    {
      headers: F(
        table(
          [
            ['Ref', 'MSA-001'],
            ['Version', '1'],
          ],
          { widths: [2000, 2000] }
        ) + p('')
      ),
    },
    {
      headers: F(
        table(
          [
            ['Ref', 'MSA-001'],
            ['Version', '2'],
          ],
          { widths: [2000, 2000] }
        ) + p('')
      ),
    }
  );
  make('header-and-body', { headers: H('Agreement') }, { headers: H('Agreement Amended') }, true);
  make(
    'footer-format',
    { footers: F(hp('Company Confidential', 'Footer')) },
    { footers: F(p('Company Confidential', style('Footer'), '<w:b/>')) }
  );
  make(
    'header-image-add',
    { headers: H('Logo header') },
    {
      headers: F(
        pRaw(r('Logo header ') + inlineImage('rIdHdrImg', 51, 381000, 381000), style('Header'))
      ),
      media: [{ name: 'header.png', bytes: solidPng(8, 8, [30, 80, 160]), rId: 'rIdHdrImg' }],
    }
  );
}

// ---------------------------------------------------------------- 11 notes

export function notesFamily(out: CompareCase[]): void {
  const add = sinkFor('notes', out);
  let seed = 11000;
  for (const kind of ['footnote', 'endnote'] as const) {
    const ref = kind === 'footnote' ? footnoteRef : endnoteRef;
    const key = kind === 'footnote' ? 'footnotes' : 'endnotes';
    const rng = rngOf(seed++);
    const texts = context(rng, 3);
    const anchored = (n: number) =>
      p(texts[0]!) +
      pRaw(r(texts[1]!) + ref(1) + (n > 1 ? r(' Further detail.') + ref(2) : '')) +
      p(texts[2]!);
    const plain = join(texts);
    const note1 = 'See the applicable schedule for details.';
    const note2 = 'This obligation survives termination.';
    add(
      `${kind}-text`,
      { body: anchored(1), [key]: { 1: note1 } },
      { body: anchored(1), [key]: { 1: `${note1} Updated annually.` } }
    );
    add(`${kind}-add`, { body: plain }, { body: anchored(1), [key]: { 1: note1 } });
    add(`${kind}-delete`, { body: anchored(1), [key]: { 1: note1 } }, { body: plain });
    add(
      `${kind}-second`,
      { body: anchored(1), [key]: { 1: note1 } },
      { body: anchored(2), [key]: { 1: note1, 2: note2 } }
    );
    add(
      `${kind}-and-body`,
      { body: anchored(1), [key]: { 1: note1 } },
      {
        body: p(texts[0]!) + pRaw(r(`${texts[1]!} ${sentence(rng)}`) + ref(1)) + p(texts[2]!),
        [key]: { 1: note1.replace('schedule', 'exhibit') },
      }
    );
  }
}

// ---------------------------------------------------------------- 12 fields and links

export function fieldsFamily(out: CompareCase[]): void {
  const add = sinkFor('fields', out);
  let seed = 12000;
  const pairOf = (name: string, base: DocSpec, revised: DocSpec) => add(name, base, revised);
  const lead = (rng: Rng) => p(paragraphText(rng, 1));
  {
    const rng = rngOf(seed++);
    const l = lead(rng);
    const links = { rIdL1: 'https://example.com/a', rIdL2: 'https://example.com/b' };
    pairOf(
      'hyperlink-text',
      {
        body: l + pRaw(r('See ') + hyperlink('rIdL1', 'the policy page') + r(' now.')),
        hyperlinks: links,
      },
      {
        body: l + pRaw(r('See ') + hyperlink('rIdL1', 'the updated policy page') + r(' now.')),
        hyperlinks: links,
      }
    );
    pairOf(
      'hyperlink-target',
      {
        body: l + pRaw(r('See ') + hyperlink('rIdL1', 'the policy page') + r(' now.')),
        hyperlinks: links,
      },
      {
        body: l + pRaw(r('See ') + hyperlink('rIdL2', 'the policy page') + r(' now.')),
        hyperlinks: links,
      }
    );
    pairOf(
      'hyperlink-add',
      { body: l + p('See the policy page now.'), hyperlinks: links },
      {
        body: l + pRaw(r('See ') + hyperlink('rIdL1', 'the policy page') + r(' now.')),
        hyperlinks: links,
      }
    );
    pairOf(
      'hyperlink-remove',
      {
        body: l + pRaw(r('See ') + hyperlink('rIdL1', 'the policy page') + r(' now.')),
        hyperlinks: links,
      },
      { body: l + p('See the policy page now.'), hyperlinks: links }
    );
  }
  const fieldPairs: ReadonlyArray<readonly [string, string, string]> = [
    [
      'date-format',
      pRaw(r('Dated: ') + field('DATE \\@ "M/d/yyyy"', '1/5/2026')),
      pRaw(r('Dated: ') + field('DATE \\@ "MMMM d, yyyy"', 'January 5, 2026')),
    ],
    [
      'page-field-add',
      p('Page reference here.'),
      pRaw(r('Page reference here: ') + field('PAGE', '1')),
    ],
    [
      'merge-field-name',
      pRaw(r('Dear ') + simpleField('MERGEFIELD FirstName', '«FirstName»')),
      pRaw(r('Dear ') + simpleField('MERGEFIELD LastName', '«LastName»')),
    ],
    [
      'field-result-change',
      pRaw(r('Total: ') + field('= 2 + 2', '4')),
      pRaw(r('Total: ') + field('= 2 + 3', '5')),
    ],
    [
      'ref-field',
      pRaw(r('As defined in ') + field('REF Definitions \\h', 'Section 1')),
      pRaw(r('As defined in ') + field('REF Definitions \\h', 'Section 2')),
    ],
    ['field-to-text', pRaw(r('Printed ') + field('DATE', '1/5/2026')), p('Printed 1/5/2026')],
  ];
  for (const [name, base, revised] of fieldPairs) {
    const rng = rngOf(seed++);
    const l = lead(rng);
    pairOf(name, { body: l + base }, { body: l + revised });
  }
  {
    const rng = rngOf(seed++);
    const h1 = heading(rng);
    const h2 = heading(rng);
    const toc = (second: string) =>
      pRaw(field('TOC \\o "1-3" \\h \\z \\u', `${h1}\t1`)) +
      p(`${second}\t1`) +
      p(h1, style('Heading1')) +
      p(paragraphText(rngOf(7))) +
      p(second, style('Heading1')) +
      p(paragraphText(rngOf(8)));
    pairOf('toc-entry', { body: toc(h2) }, { body: toc(`${h2} Revised`) });
  }
}

// ---------------------------------------------------------------- 13 drawings

export function drawingsFamily(out: CompareCase[]): void {
  const add = sinkFor('drawings', out);
  let seed = 13000;
  const red = solidPng(16, 16, [200, 40, 40]);
  const blue = solidPng(16, 16, [40, 80, 200]);
  const img = (bytes: Uint8Array, rId = 'rIdImg1') => [{ name: `${rId}.png`, bytes, rId }];
  const pic = (cx?: number, cy?: number) => inlineImage('rIdImg1', 1, cx, cy);
  const make = (name: string, build: (lead: string, tail: string) => [DocSpec, DocSpec]) => {
    const rng = rngOf(seed++);
    const [base, revised] = build(p(paragraphText(rng, 1)), p(paragraphText(rng, 1)));
    add(name, base, revised);
  };
  make('image-replace', (l, t) => [
    { body: l + pRaw(pic()) + t, media: img(red) },
    { body: l + pRaw(pic()) + t, media: img(blue) },
  ]);
  make('image-insert', (l, t) => [{ body: l + t }, { body: l + pRaw(pic()) + t, media: img(red) }]);
  make('image-delete', (l, t) => [{ body: l + pRaw(pic()) + t, media: img(red) }, { body: l + t }]);
  make('image-resize', (l, t) => [
    { body: l + pRaw(pic()) + t, media: img(red) },
    { body: l + pRaw(pic(1905000, 1905000)) + t, media: img(red) },
  ]);
  make('image-inline-with-text', (l, t) => [
    { body: l + pRaw(r('Logo ') + pic() + r(' appears here.')) + t, media: img(red) },
    { body: l + pRaw(r('Logo ') + pic() + r(' appears above.')) + t, media: img(red) },
  ]);
  make('image-in-cell', (l, t) => [
    { body: l + table([[{ text: '', raw: pRaw(pic()) }, 'Caption one']]) + t, media: img(red) },
    { body: l + table([[{ text: '', raw: pRaw(pic()) }, 'Caption two']]) + t, media: img(red) },
  ]);
  make('textbox-text', (l, t) => [
    { body: l + pRaw(textBox(p('Box text original.'), 1)) + t },
    { body: l + pRaw(textBox(p('Box text revised.'), 1)) + t },
  ]);
  make('textbox-add', (l, t) => [
    { body: l + t },
    { body: l + pRaw(textBox(p('A new note box.'), 1)) + t },
  ]);
}

// ---------------------------------------------------------------- 14 controls and bookmarks

export function controlsFamily(out: CompareCase[]): void {
  const add = sinkFor('controls', out);
  let seed = 14000;
  const make = (name: string, base: string, revised: string) => {
    const rng = rngOf(seed++);
    const l = p(paragraphText(rng, 1));
    add(name, l + base, l + revised);
  };
  make(
    'sdt-inline-text',
    pRaw(r('Client: ') + sdtRun('Client', r('Northwind Group'), 101)),
    pRaw(r('Client: ') + sdtRun('Client', r('Contoso Group'), 101))
  );
  make(
    'sdt-inline-add',
    p('Client: Northwind Group'),
    pRaw(r('Client: ') + sdtRun('Client', r('Northwind Group'), 101))
  );
  make(
    'sdt-inline-remove',
    pRaw(r('Client: ') + sdtRun('Client', r('Northwind Group'), 101)),
    p('Client: Northwind Group')
  );
  make(
    'sdt-block-text',
    sdtBlock('Terms', p('Payment is due in thirty days.') + p('Late fees apply.'), 102),
    sdtBlock('Terms', p('Payment is due in sixty days.') + p('Late fees apply.'), 102)
  );
  make(
    'bookmark-text',
    pRaw(r('See ') + bookmark(1, 'Definitions', r('the definitions')) + r(' below.')),
    pRaw(r('See ') + bookmark(1, 'Definitions', r('the defined terms')) + r(' below.'))
  );
  make(
    'bookmark-add',
    p('See the definitions below.'),
    pRaw(r('See ') + bookmark(1, 'Definitions', r('the definitions')) + r(' below.'))
  );
  make(
    'checkbox-state',
    pRaw(sdtRun('Agree', r('☐'), 103) + r(' I agree to the terms.')),
    pRaw(sdtRun('Agree', r('☒'), 103) + r(' I agree to the terms.'))
  );
}

// ---------------------------------------------------------------- 15 comments and existing revisions

export function reviewStateFamily(out: CompareCase[]): void {
  const add = sinkFor('review-state', out);
  let seed = 15000;
  const rng0 = rngOf(seed++);
  const [a, b, c] = context(rng0, 3);
  const plain = join([a!, b!, c!]);
  const withComment = (text: string, id = 1) =>
    p(a!) + pRaw(r('The fee ') + commented(id, r(text)) + r(' applies.')) + p(c!);
  const comment = (text: string, author = 'Reviewer One') => [{ id: 1, author, text }];
  add(
    'comment-base-only',
    { body: withComment('is fixed'), comments: comment('Please confirm.') },
    { body: p(a!) + p('The fee is fixed applies.') + p(c!) }
  );
  add(
    'comment-revised-only',
    { body: p(a!) + p('The fee is fixed applies.') + p(c!) },
    { body: withComment('is fixed'), comments: comment('New question.', 'Reviewer Two') }
  );
  add(
    'comment-both-different',
    { body: withComment('is fixed'), comments: comment('First view.') },
    { body: withComment('is fixed'), comments: comment('Second view.', 'Reviewer Two') }
  );
  add(
    'comment-anchor-text-changed',
    { body: withComment('is fixed'), comments: comment('Check this.') },
    { body: withComment('is variable'), comments: comment('Check this.') }
  );
  add(
    'base-pending-insert',
    p(a!) + pRaw(r('The term ') + insWrap(r('initially ')) + r('runs one year.')) + p(c!),
    p(a!) + p('The term initially runs two years.') + p(c!)
  );
  add(
    'base-pending-delete',
    p(a!) + pRaw(r('The term ') + delWrap(rDel('initially ')) + r('runs one year.')) + p(c!),
    p(a!) + p('The term runs two years.') + p(c!)
  );
  add(
    'revised-pending-insert',
    plain,
    p(a!) + pRaw(r(b!) + insWrap(r(' Additional text.'), 'Other Editor')) + p(c!)
  );
  add(
    'revised-pending-format',
    plain,
    p(a!) +
      pRaw(
        `<w:r><w:rPr><w:b/>${rPrChange('')}</w:rPr><w:t xml:space="preserve">${b!}</w:t></w:r>`
      ) +
      p(c!)
  );
  add(
    'both-pending',
    p(a!) + pRaw(r('Alpha ') + insWrap(r('beta '))) + p(c!),
    p(a!) + pRaw(r('Alpha ') + delWrap(rDel('beta ')) + r('gamma')) + p(c!)
  );
  add(
    'pending-paragraph-insert',
    plain,
    p(a!) +
      p(b!) +
      `<w:p><w:pPr><w:rPr>${insWrap('').replace('></w:ins>', '/>')}</w:rPr></w:pPr>${insWrap(r('Inserted by another reviewer.'))}</w:p>` +
      p(c!)
  );
}

// ---------------------------------------------------------------- 16 whole documents

export function wholeDocumentFamily(out: CompareCase[]): void {
  const add = sinkFor('whole-document', out);
  let seed = 16000;
  const richDoc = (rng: Rng): string =>
    p(heading(rng), style('Title')) +
    p(heading(rng), style('Heading1')) +
    join(context(rng, 3)) +
    Array.from({ length: 3 }, () => p(sentence(rng, 4, 8), listPr(2))).join('') +
    table(grid(rng, 3, 3)) +
    p(heading(rng), style('Heading2')) +
    join(context(rng, 2));
  for (let i = 0; i < 3; i++) {
    const rng = rngOf(seed++);
    const body = i === 0 ? join(context(rng, 3)) : richDoc(rng);
    add(`identical-${i}`, body, body);
  }
  {
    const rng = rngOf(seed++);
    const body = richDoc(rng);
    add('empty-to-full', p(''), body);
    add('full-to-empty', body, p(''));
  }
  for (let i = 0; i < 5; i++) {
    const a = rngOf(seed++);
    const b = rngOf(seed + 500 + i);
    add(
      `unrelated-${i}`,
      i % 2 ? richDoc(a) : join(context(a, 4 + i)),
      i % 2 ? richDoc(b) : join(context(b, 3 + i * 2))
    );
  }
  // Long documents with scattered edits. Roughly 4 paragraphs per page.
  for (const pages of [5, 20, 50, 200]) {
    const rng = rngOf(seed++);
    const count = pages * 4;
    const blocks: string[] = [];
    const edited: string[] = [];
    for (let i = 0; i < count; i++) {
      const text = i % 25 === 0 ? heading(rng) : paragraphText(rng);
      const pPr = i % 25 === 0 ? style('Heading1') : '';
      blocks.push(p(text, pPr));
      if (i % 37 === 5) edited.push(p(`${text} ${sentence(rng)}`, pPr));
      else if (i % 53 === 7) continue;
      else edited.push(p(text, pPr));
      if (i % 61 === 11) edited.push(p(paragraphText(rng)));
    }
    add(`long-${pages}-pages`, blocks.join(''), edited.join(''));
  }
  {
    const rng = rngOf(seed++);
    const body = richDoc(rng);
    const changed = body.replace(
      /<w:t xml:space="preserve">([a-z]+) /,
      '<w:t xml:space="preserve">$1 newly '
    );
    add('rich-small-edit', body, changed);
  }
}
