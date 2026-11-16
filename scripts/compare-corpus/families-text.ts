/** Corpus families 1-7: words, token rules, scripts, paragraphs, run and paragraph formatting, lists. */
import type { DocSpec } from './docx-builder.ts';
import {
  heading,
  int,
  listPr,
  p,
  paragraphText,
  pRaw,
  r,
  rngOf,
  sentence,
  style,
  words,
  type Rng,
} from './xml.ts';

export interface CompareCase {
  readonly family: string;
  readonly name: string;
  readonly base: DocSpec;
  readonly revised: DocSpec;
}

export type CaseSink = (name: string, base: DocSpec | string, revised: DocSpec | string) => void;

export function sinkFor(family: string, out: CompareCase[]): CaseSink {
  return (name, base, revised) => {
    const asSpec = (value: DocSpec | string): DocSpec =>
      typeof value === 'string' ? { body: value } : value;
    out.push({ family, name, base: asSpec(base), revised: asSpec(revised) });
  };
}

/** Paragraph texts around an edited paragraph, so alignment has context. */
function context(rng: Rng, count: number): string[] {
  return Array.from({ length: count }, () => paragraphText(rng));
}

const join = (texts: readonly string[], pPr = '') => texts.map((text) => p(text, pPr)).join('');

type Position = 'start' | 'middle' | 'end';
const POSITIONS: readonly Position[] = ['start', 'middle', 'end'];
const at = (list: readonly string[], position: Position, span = 0) =>
  position === 'start'
    ? 0
    : position === 'end'
      ? Math.max(0, list.length - span)
      : Math.floor((list.length - span) / 2);

function editWords(
  rng: Rng,
  source: string,
  op: 'insert' | 'delete' | 'replace',
  position: Position,
  count: number
): string {
  const list = source.split(' ');
  const index = at(list, position, op === 'insert' ? 0 : count);
  if (op === 'insert') list.splice(index, 0, ...words(rng, count));
  else if (op === 'delete') list.splice(index, count);
  else list.splice(index, count, ...words(rng, count).map((w) => `${w}x`.replace(/x$/, 'ed')));
  if (position === 'start' && list[0]) list[0] = list[0].charAt(0).toUpperCase() + list[0].slice(1);
  let text = list.join(' ');
  if (!text.endsWith('.')) text = `${text.replace(/[.]?$/, '')}.`;
  return text;
}

// ---------------------------------------------------------------- 1 words

export function wordsFamily(out: CompareCase[]): void {
  const add = sinkFor('words', out);
  let seed = 1000;
  for (const op of ['insert', 'delete', 'replace'] as const) {
    for (const position of POSITIONS) {
      for (const count of [1, 3]) {
        const rng = rngOf(seed++);
        const around = context(rng, 3);
        const edited = editWords(rng, around[1]!, op, position, count);
        add(`${op}-${position}-${count}`, join(around), join([around[0]!, edited, around[2]!]));
      }
    }
  }
  for (let i = 0; i < 4; i++) {
    const rng = rngOf(seed++);
    const around = context(rng, 3);
    const list = around[1]!.split(' ');
    list.splice(4, 1, 'amended');
    list.splice(6, 1, 'revised');
    if (i % 2) list.splice(5, 0, 'newly');
    add(`adjacent-edits-${i}`, join(around), join([around[0]!, list.join(' '), around[2]!]));
  }
  for (let i = 0; i < 4; i++) {
    const rng = rngOf(seed++);
    const texts = context(rng, 6);
    const edited = texts.map((text, index) =>
      index % 2 === i % 2 ? editWords(rng, text, 'replace', 'middle', 1) : text
    );
    add(`scattered-edits-${i}`, join(texts), join(edited));
  }
  for (let i = 0; i < 3; i++) {
    const rng = rngOf(seed++);
    const texts = context(rng, 4);
    add(
      `every-paragraph-${i}`,
      join(texts),
      join(texts.map((text) => editWords(rng, text, 'insert', 'end', 2)))
    );
  }
  for (const [index, [from, to]] of [
    ['contract', 'contarct'],
    ['payment', 'payments'],
    ['shall', 'should'],
    ['notice', 'notices'],
  ].entries()) {
    const rng = rngOf(seed++);
    const lead = sentence(rng);
    add(
      `one-word-variant-${index}`,
      p(`${lead} The ${from} terms apply to the parties.`),
      p(`${lead} The ${to} terms apply to the parties.`)
    );
  }
  for (let i = 0; i < 3; i++) {
    const rng = rngOf(seed++);
    const texts = context(rng, 3);
    const middle = texts[1]!.split('. ');
    middle[0] = sentence(rng).replace(/\.$/, '');
    add(`sentence-rewrite-${i}`, join(texts), join([texts[0]!, middle.join('. '), texts[2]!]));
  }
  for (const size of [20, 60]) {
    const rng = rngOf(seed++);
    const texts = context(rng, size);
    const edited = [...texts];
    edited[Math.floor(size / 3)] = editWords(
      rng,
      edited[Math.floor(size / 3)]!,
      'replace',
      'middle',
      2
    );
    edited[Math.floor((2 * size) / 3)] = editWords(
      rng,
      edited[Math.floor((2 * size) / 3)]!,
      'delete',
      'end',
      3
    );
    add(`long-context-${size}`, join(texts), join(edited));
  }
}

// ---------------------------------------------------------------- 2 token rules

export function tokensFamily(out: CompareCase[]): void {
  const add = sinkFor('tokens', out);
  const pairs: ReadonlyArray<readonly [string, string, string]> = [
    [
      'comma-add',
      'The fee is due on receipt and payable in full',
      'The fee is due on receipt, and payable in full',
    ],
    [
      'comma-remove',
      'Each party, acting in good faith, shall cooperate',
      'Each party acting in good faith shall cooperate',
    ],
    [
      'semicolon',
      'The term is one year, renewable by notice',
      'The term is one year; renewable by notice',
    ],
    ['period-to-exclamation', 'Notice must be given promptly.', 'Notice must be given promptly!'],
    ['apostrophe', 'The provider and its affiliates', "The provider and it's affiliates"],
    ['curly-apostrophe', "The customer's records", 'The customer’s records'],
    ['quotes-straight-to-curly', 'The term "Services" means', 'The term “Services” means'],
    ['hyphen-add', 'a long term agreement', 'a long-term agreement'],
    ['hyphen-remove', 'a non-exclusive license', 'a nonexclusive license'],
    ['en-dash', 'pages 10-12 of the schedule', 'pages 10–12 of the schedule'],
    [
      'em-dash',
      'the provider - and only the provider - may',
      'the provider—and only the provider—may',
    ],
    ['number-digit', 'within 104 days of the date', 'within 105 days of the date'],
    ['number-grouped', 'a fee of 1,000 units', 'a fee of 1,500 units'],
    ['number-decimal', 'a rate of 3.14 percent', 'a rate of 3.15 percent'],
    ['currency', 'a cap of $100 per month', 'a cap of $120 per month'],
    ['percent', 'a discount of 10% on renewal', 'a discount of 12% on renewal'],
    ['iso-date', 'effective 2026-01-01 for all orders', 'effective 2026-02-01 for all orders'],
    ['long-date', 'signed on January 5, 2026 by both', 'signed on January 6, 2026 by both'],
    [
      'url',
      'see https://example.com/terms/v1 for details',
      'see https://example.com/terms/v2 for details',
    ],
    [
      'email',
      'send notices to legal@example.com today',
      'send notices to notices@example.com today',
    ],
    ['case-word', 'This Agreement binds the parties', 'This agreement binds the parties'],
    ['case-caps', 'the limitation of liability applies', 'the LIMITATION OF LIABILITY applies'],
    ['double-space', 'The parties agree to the terms', 'The parties agree  to the terms'],
    ['trailing-space', 'The parties agree to the terms', 'The parties agree to the terms '],
    ['leading-space', 'The parties agree to the terms', ' The parties agree to the terms'],
    ['tab-insert', 'Item one description', 'Item one\tdescription'],
    ['nbsp', 'Section 4 applies', 'Section 4 applies'],
    ['section-ref', 'as set out in Section 4.2(a) below', 'as set out in Section 4.2(b) below'],
    ['abbreviation', 'certain costs, e.g. travel, apply', 'certain costs, i.e. travel, apply'],
    ['parenthesis', 'the fee (excluding taxes) is due', 'the fee (including taxes) is due'],
    ['slash', 'the customer and/or its affiliates', 'the customer or its affiliates'],
    ['ellipsis', 'the list continues...', 'the list continues…'],
    ['trailing-period', 'The parties agree.', 'The parties agree'],
    ['word-split', 'the workflow is automated', 'the work flow is automated'],
    ['word-join', 'the data base is encrypted', 'the database is encrypted'],
    ['ordinal', 'on the 1st day of each month', 'on the 15th day of each month'],
    ['plural', 'the party shall pay', 'the parties shall pay'],
    ['symbol', 'Copyright (c) 2026', 'Copyright © 2026'],
    ['number-word', 'within thirty (30) days', 'within sixty (60) days'],
    ['roman', 'see Article IV of the plan', 'see Article VI of the plan'],
  ];
  let seed = 2000;
  for (const [name, before, after] of pairs) {
    const rng = rngOf(seed++);
    const lead = sentence(rng);
    const tail = sentence(rng);
    add(name, p(`${lead} ${before} ${tail}`), p(`${lead} ${after} ${tail}`));
  }
}

// ---------------------------------------------------------------- 3 scripts

export function scriptsFamily(out: CompareCase[]): void {
  const add = sinkFor('scripts', out);
  const rtl = '<w:bidi/>';
  const rtlRun = '<w:rtl/>';
  const cases: ReadonlyArray<readonly [string, string, string, string?, string?]> = [
    ['cjk-replace', '本协议自双方签署之日起生效。', '本协议自双方盖章之日起生效。'],
    ['cjk-insert', '供应商应当提供技术支持。', '供应商应当及时提供技术支持。'],
    ['cjk-delete', '本条款在协议终止后继续有效。', '本条款在终止后继续有效。'],
    ['cjk-mixed-latin', '本协议适用 Section 5 的规定。', '本协议适用 Section 6 的规定。'],
    ['japanese', 'この契約は署名日から有効です。', 'この契約は締結日から有効です。'],
    ['korean', '본 계약은 서명일로부터 유효합니다.', '본 계약은 체결일로부터 유효합니다.'],
    ['thai', 'สัญญานี้มีผลตั้งแต่วันที่ลงนาม', 'สัญญานี้มีผลตั้งแต่วันที่ทำสัญญา'],
    ['arabic', 'يسري هذا العقد من تاريخ التوقيع', 'يسري هذا العقد من تاريخ الإبرام', rtl, rtlRun],
    ['hebrew', 'הסכם זה בתוקף מיום החתימה', 'הסכם זה בתוקף מיום האישור', rtl, rtlRun],
    ['arabic-digits', 'المبلغ 100 دولار', 'المبلغ 150 دولار', rtl, rtlRun],
    ['greek', 'Η σύμβαση ισχύει από την υπογραφή.', 'Η σύμβαση ισχύει από την έγκριση.'],
    [
      'cyrillic',
      'Договор вступает в силу с даты подписания.',
      'Договор вступает в силу с даты утверждения.',
    ],
    ['emoji-insert', 'Approved by the team', 'Approved by the team ✅'],
    ['emoji-replace', 'Status \u{1F7E2} ready', 'Status \u{1F534} ready'],
    ['combining-accent', 'the café premises', 'the café premises'],
    ['accented-word', 'the resume of the applicant', 'the résumé of the applicant'],
    [
      'german',
      'Die Vertragsparteien vereinbaren Folgendes.',
      'Die Vertragsparteien vereinbaren das Folgende.',
    ],
    ['vietnamese', 'Hợp đồng có hiệu lực từ ngày ký.', 'Hợp đồng có hiệu lực từ ngày phê duyệt.'],
  ];
  let seed = 3000;
  for (const [name, before, after, pPr = '', rPr = ''] of cases) {
    const rng = rngOf(seed++);
    const lead = paragraphText(rng, 1);
    add(name, p(lead) + p(before, pPr, rPr), p(lead) + p(after, pPr, rPr));
  }
  {
    const rng = rngOf(seed++);
    const lead = paragraphText(rng, 1);
    add(
      'mixed-bidi',
      p(lead) + pRaw(r('The term ') + r('العقد', rtlRun) + r(' applies here.')),
      p(lead) + pRaw(r('The term ') + r('الاتفاقية', rtlRun) + r(' applies here.'))
    );
  }
}

// ---------------------------------------------------------------- 4 paragraphs

export function paragraphsFamily(out: CompareCase[]): void {
  const add = sinkFor('paragraphs', out);
  let seed = 4000;
  for (const position of POSITIONS) {
    for (const count of [1, 3]) {
      const rng = rngOf(seed++);
      const texts = context(rng, 6);
      const fresh = context(rng, count);
      const inserted = [...texts];
      inserted.splice(at(texts, position), 0, ...fresh);
      add(`insert-${position}-${count}`, join(texts), join(inserted));
      const removed = [...texts];
      removed.splice(at(texts, position, count), count);
      add(`delete-${position}-${count}`, join(texts), join(removed));
    }
  }
  for (let i = 0; i < 3; i++) {
    const rng = rngOf(seed++);
    const texts = context(rng, 4);
    const sentences = texts[1]!.split('. ');
    const cut = Math.max(1, Math.floor(sentences.length / 2));
    const first = `${sentences.slice(0, cut).join('. ')}${sentences.slice(0, cut).join('. ').endsWith('.') ? '' : '.'}`;
    const second = sentences.slice(cut).join('. ');
    add(
      `split-${i}`,
      join(texts),
      join([texts[0]!, first, second || sentence(rng), texts[2]!, texts[3]!])
    );
    add(
      `merge-${i}`,
      join([texts[0]!, first, second || 'Tail.', texts[2]!]),
      join([texts[0]!, `${first} ${second || 'Tail.'}`, texts[2]!])
    );
  }
  for (let i = 0; i < 2; i++) {
    const rng = rngOf(seed++);
    const texts = context(rng, 4);
    add(`empty-insert-${i}`, join(texts), join([texts[0]!, texts[1]!, '', texts[2]!, texts[3]!]));
    add(
      `empty-delete-${i}`,
      join([texts[0]!, '', texts[1]!, texts[2]!]),
      join([texts[0]!, texts[1]!, texts[2]!])
    );
  }
  for (let i = 0; i < 3; i++) {
    const rng = rngOf(seed++);
    const texts = context(rng, 5);
    const swapped = [...texts];
    [swapped[1], swapped[2]] = [swapped[2]!, swapped[1]!];
    add(`swap-${i}`, join(texts), join(swapped));
  }
  for (const size of [6, 12, 24]) {
    const rng = rngOf(seed++);
    const texts = context(rng, size);
    const moved = [...texts];
    const [item] = moved.splice(1, 1);
    moved.splice(size - 1, 0, item!);
    add(`move-far-${size}`, join(texts), join(moved));
  }
  // Similarity sweep: share of words replaced inside one paragraph.
  for (let percent = 10; percent <= 90; percent += 10) {
    for (const variant of [0, 1]) {
      const rng = rngOf(seed++);
      const texts = context(rng, 3);
      const list = words(rng, 30);
      const base = `${list.join(' ')}.`;
      const changed = [...list];
      const count = Math.round((percent / 100) * list.length);
      for (let k = 0; k < count; k++) {
        const index = variant === 0 ? Math.floor((k * list.length) / count) : k;
        changed[index] = `${changed[index]!}s`;
      }
      add(
        `similarity-${percent}-${variant === 0 ? 'spread' : 'block'}`,
        join([texts[0]!, base, texts[2]!]),
        join([texts[0]!, `${changed.join(' ')}.`, texts[2]!])
      );
    }
  }
  for (let i = 0; i < 2; i++) {
    const rng = rngOf(seed++);
    const title = heading(rng);
    const texts = context(rng, 2);
    add(
      `heading-text-${i}`,
      p(title, style('Heading1')) + join(texts),
      p(`${title} ${heading(rng)}`, style('Heading1')) + join(texts)
    );
  }
  {
    const rng = rngOf(seed++);
    const texts = context(rng, 5);
    const replaced = context(rngOf(seed++), 5);
    add('replace-all-paragraphs', join(texts), join(replaced));
  }
}

// ---------------------------------------------------------------- 5 run formatting

export function runFormattingFamily(out: CompareCase[]): void {
  const add = sinkFor('run-formatting', out);
  const props: ReadonlyArray<readonly [string, string, string?]> = [
    ['bold', '<w:b/><w:bCs/>'],
    ['italic', '<w:i/><w:iCs/>'],
    ['underline', '<w:u w:val="single"/>'],
    ['double-underline', '<w:u w:val="double"/>'],
    ['strike', '<w:strike/>'],
    [
      'font',
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>',
    ],
    ['size', '<w:sz w:val="28"/><w:szCs w:val="28"/>'],
    ['color', '<w:color w:val="C00000"/>'],
    ['highlight', '<w:highlight w:val="yellow"/>'],
    ['char-style', '<w:rStyle w:val="Strong"/>'],
    ['superscript', '<w:vertAlign w:val="superscript"/>'],
    ['small-caps', '<w:smallCaps/>'],
    ['all-caps', '<w:caps/>'],
    ['shading', '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>'],
    ['spacing', '<w:spacing w:val="20"/>'],
    ['multiple', '<w:b/><w:i/><w:color w:val="2F5496"/>'],
  ];
  let seed = 5000;
  for (const [name, rPr] of props) {
    const rng = rngOf(seed++);
    const lead = words(rng, 6).join(' ');
    const target = words(rng, 2).join(' ');
    const tail = `${words(rng, 7).join(' ')}.`;
    add(
      `${name}-words`,
      pRaw(r(`${lead} ${target} ${tail}`)),
      pRaw(r(`${lead} `) + r(target, rPr) + r(` ${tail}`))
    );
  }
  for (const [name, rPr] of props.slice(0, 6)) {
    const rng = rngOf(seed++);
    const text = paragraphText(rng, 2);
    add(`${name}-paragraph`, p(text), p(text, '', rPr));
    add(`${name}-removed`, p(text, '', rPr), p(text));
  }
  for (let i = 0; i < 3; i++) {
    const rng = rngOf(seed++);
    const lead = words(rng, 5).join(' ');
    const tail = `${words(rng, 6).join(' ')}.`;
    add(
      `format-and-text-same-word-${i}`,
      pRaw(r(`${lead} payment ${tail}`)),
      pRaw(r(`${lead} `) + r('payments', '<w:b/>') + r(` ${tail}`))
    );
    add(
      `format-next-to-text-${i}`,
      pRaw(r(`${lead} payment terms ${tail}`)),
      pRaw(r(`${lead} invoice `) + r('terms', '<w:i/>') + r(` ${tail}`))
    );
  }
  {
    const rng = rngOf(seed++);
    const text = paragraphText(rng, 2);
    add(
      'font-change-whole-doc',
      join([text, paragraphText(rng)]),
      [text, paragraphText(rngOf(seed))]
        .map((t) => p(t, '', '<w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>'))
        .join('')
    );
  }
}

// ---------------------------------------------------------------- 6 paragraph formatting

export function paragraphFormattingFamily(out: CompareCase[]): void {
  const add = sinkFor('paragraph-formatting', out);
  const changes: ReadonlyArray<readonly [string, string, string]> = [
    ['normal-to-heading1', '', style('Heading1')],
    ['heading1-to-heading2', style('Heading1'), style('Heading2')],
    ['to-quote', '', style('Quote')],
    ['to-title', '', style('Title')],
    ['align-center', '', '<w:jc w:val="center"/>'],
    ['align-right', '', '<w:jc w:val="right"/>'],
    ['align-justify', '', '<w:jc w:val="both"/>'],
    ['align-reset', '<w:jc w:val="center"/>', ''],
    ['indent-left', '', '<w:ind w:left="720"/>'],
    ['indent-first-line', '', '<w:ind w:firstLine="720"/>'],
    ['indent-hanging', '', '<w:ind w:left="720" w:hanging="360"/>'],
    ['spacing-before-after', '', '<w:spacing w:before="240" w:after="240"/>'],
    ['line-spacing-double', '', '<w:spacing w:line="480" w:lineRule="auto"/>'],
    ['keep-next', '', '<w:keepNext/>'],
    ['page-break-before', '', '<w:pageBreakBefore/>'],
    [
      'border',
      '',
      '<w:pBdr><w:top w:val="single" w:sz="4" w:space="1" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="1" w:color="auto"/></w:pBdr>',
    ],
    ['shading', '', '<w:shd w:val="clear" w:color="auto" w:fill="FFF2CC"/>'],
    ['tabs', '', '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>'],
  ];
  let seed = 6000;
  for (const [name, before, after] of changes) {
    const rng = rngOf(seed++);
    const texts = context(rng, 3);
    const middle =
      name.startsWith('heading') || name.endsWith('heading1') || name === 'to-title'
        ? heading(rng)
        : texts[1]!;
    add(
      name,
      p(texts[0]!) + p(middle, before) + p(texts[2]!),
      p(texts[0]!) + p(middle, after) + p(texts[2]!)
    );
  }
  for (let i = 0; i < 2; i++) {
    const rng = rngOf(seed++);
    const texts = context(rng, 3);
    add(
      `style-and-text-${i}`,
      join(texts),
      p(texts[0]!) +
        p(editWords(rng, texts[1]!, 'replace', 'middle', 2), style('Quote')) +
        p(texts[2]!)
    );
  }
}

// ---------------------------------------------------------------- 7 lists

export function listsFamily(out: CompareCase[]): void {
  const add = sinkFor('lists', out);
  let seed = 7000;
  const items = (rng: Rng, count: number) =>
    Array.from({ length: count }, () => sentence(rng, 4, 9));
  const list = (texts: readonly string[], numId: number, levels?: readonly number[]) =>
    texts.map((text, index) => p(text, listPr(numId, levels?.[index] ?? 0))).join('');
  for (const numId of [1, 2]) {
    const kind = numId === 1 ? 'bullet' : 'number';
    const rng = rngOf(seed++);
    const lead = p(paragraphText(rng, 1));
    const texts = items(rng, 5);
    const withExtra = [...texts];
    withExtra.splice(2, 0, sentence(rng, 4, 9));
    add(`${kind}-add-middle`, lead + list(texts, numId), lead + list(withExtra, numId));
    add(
      `${kind}-add-end`,
      lead + list(texts, numId),
      lead + list([...texts, sentence(rng, 4, 9)], numId)
    );
    add(
      `${kind}-remove`,
      lead + list(texts, numId),
      lead +
        list(
          texts.filter((_, i) => i !== 1),
          numId
        )
    );
    add(`${kind}-level`, lead + list(texts, numId), lead + list(texts, numId, [0, 1, 1, 0, 0]));
    add(
      `${kind}-text`,
      lead + list(texts, numId),
      lead +
        list(
          texts.map((t, i) => (i === 3 ? editWords(rng, t, 'replace', 'middle', 1) : t)),
          numId
        )
    );
    const swapped = [...texts];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    add(`${kind}-reorder`, lead + list(texts, numId), lead + list(swapped, numId));
    add(`${kind}-to-plain`, lead + list(texts, numId), lead + join(texts));
    add(`plain-to-${kind}`, lead + join(texts), lead + list(texts, numId));
  }
  {
    const rng = rngOf(seed++);
    const texts = items(rng, 4);
    add('bullet-to-number', list(texts, 1), list(texts, 2));
    add('number-to-letter', list(texts, 2), list(texts, 4));
    add(
      'restart-numbering',
      list(texts.slice(0, 2), 2) + p(paragraphText(rng, 1)) + list(texts.slice(2), 2),
      list(texts.slice(0, 2), 2) + p(paragraphText(rngOf(seed - 1), 1)) + list(texts.slice(2), 3)
    );
    add(
      'nested-insert',
      list(texts, 2),
      list([texts[0]!, texts[1]!, sentence(rng, 4, 8), texts[2]!, texts[3]!], 2, [0, 0, 1, 0, 0])
    );
  }
  for (const size of [12, 30]) {
    const rng = rngOf(seed++);
    const texts = items(rng, size);
    const edited = texts.map((t, i) =>
      i === Math.floor(size / 2) ? editWords(rng, t, 'insert', 'end', 2) : t
    );
    edited.splice(3, 1);
    add(`long-list-${size}`, list(texts, 2), list(edited, 2));
  }
  {
    const rng = rngOf(seed++);
    const n = int(rng, 3, 4);
    const texts = items(rng, n);
    add(
      'list-items-split',
      list(texts, 1),
      list(
        [...texts.slice(0, 1), 'Inserted point one.', 'Inserted point two.', ...texts.slice(1)],
        1
      )
    );
  }
}
