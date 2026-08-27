// CJK text breaks at the margin, not at run seams (#526).
//
// A Chinese clause carries no spaces, so under space-only break rules it was one giant
// "word": a single-run paragraph wrapped only through the wider-than-empty-line chop, and a
// clause split across runs wrapped AT THE RUN SEAM — the only "boundary" it had. A numbered
// clause ("1." in one piece, the clause in the next) stranded the number alone on its line,
// because the line was never empty and the chop never ran. UAX #14 instead gives ideographic
// characters a break opportunity on both sides, minus the kinsoku prohibitions: a line must
// not start with a closing mark (。，、」…) and must not end with an opening one (「（…).

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { breakParagraph } from '../paragraph-flow.ts';
import { createFixedMeasurer } from '../semantic-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
/** 6pt per character, so a 60pt measure holds exactly ten. */
const measurer = createFixedMeasurer(6, 14);

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

const linesOf = (body: string, width = 60): string[] =>
  breakParagraph(paragraph(body), 'p', 0, width, measurer, undefined, null).map((line) =>
    line.spans.map((span) => span.text).join('')
  );

// The 6pt measurer base describes an 11pt run, so runs author `w:sz="22"` rather than the
// 10pt terminal fallback (see `DEFAULT_RUN_STYLE`), which widens the measure by 11/10.
const run = (text: string) =>
  `<w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

const LINE_START_FORBIDDEN = /^[。，、；：？！」』）】]/;
const LINE_END_FORBIDDEN = /[「『（【]$/;

describe('CJK text wraps at the column width', () => {
  test('a single all-CJK run fills every line', () => {
    // 24 ideographs at 6pt each against a 60pt measure: ten per line, no chop needed.
    expect(
      linesOf(`<w:p>${run('天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏')}</w:p>`)
    ).toEqual(['天地玄黄宇宙洪荒日月', '盈昃辰宿列张寒来暑往', '秋收冬藏']);
  });

  test('a CJK clause split across runs wraps at the margin, not at the run seam (#526)', () => {
    // Seven ideographs per run. Under space-only rules the seam was the only boundary, so
    // the first line carried seven characters and the margin was ignored.
    expect(linesOf(`<w:p>${run('天地玄黄宇宙洪')}${run('荒日月盈昃辰宿')}</w:p>`)).toEqual([
      '天地玄黄宇宙洪荒日月',
      '盈昃辰宿',
    ]);
  });

  test('a numbered clause fills its first line instead of stranding the number', () => {
    // "1." in its own piece, the clause in the next — the shape the eastAsia font-slot split
    // produces for 「1.甲方…」. The number must stay glued to the first ideograph (no break
    // between "." and 甲) and the line must fill to the measure.
    const lines = linesOf(`<w:p>${run('1.')}${run('甲方必须遵守安全管理规定')}</w:p>`);
    expect(lines).toEqual(['1.甲方必须遵守安全', '管理规定']);
  });
});

describe('kinsoku prohibitions', () => {
  test('a closing mark never opens a line; its carrier wraps down with it', () => {
    // Ten ideographs fill the line exactly, and the eleventh character is 、 — breaking
    // before it would fit ten but start the next line with the mark, so 月 wraps down too.
    expect(linesOf(`<w:p>${run('天地玄黄宇宙洪荒日月、盈昃辰宿')}</w:p>`)).toEqual([
      '天地玄黄宇宙洪荒日',
      '月、盈昃辰宿',
    ]);
  });

  test('an opening bracket never ends a line; it wraps down to its content', () => {
    expect(linesOf(`<w:p>${run('天地玄黄宇宙洪荒日「月盈昃辰宿')}</w:p>`)).toEqual([
      '天地玄黄宇宙洪荒日',
      '「月盈昃辰宿',
    ]);
  });

  test('no wrap position violates kinsoku across a punctuated paragraph', () => {
    const text =
      '甲方（以下简称「买方」）应当按照本合同第３条、第４条之约定，向乙方支付全部价款。逾期未付的，每日加收０．５％。';
    for (const width of [36, 48, 60, 72, 90]) {
      const lines = linesOf(`<w:p>${run(text)}</w:p>`, width);
      expect(lines.join('')).toBe(text);
      for (const line of lines) {
        expect(line).not.toMatch(LINE_START_FORBIDDEN);
        expect(line).not.toMatch(LINE_END_FORBIDDEN);
      }
    }
  });

  test('a literal space before a full-width comma no longer forces a premature break', () => {
    // The authored-space shape 「…职责 ，因此…」: the space boundary sits directly before 、
    // a closing mark, which used to hand the comma's whole tail to the next line and close
    // this one seven characters early. The space stays a break opportunity everywhere else;
    // only the position directly before the comma is vetoed.
    expect(linesOf(`<w:p>${run('安全管理职责 ，因此甲乙双方')}</w:p>`)).toEqual([
      '安全管理职责 ，因此',
      '甲乙双方',
    ]);
  });
});

describe('Latin behaviour is unchanged', () => {
  test('spaces stay the only boundary inside Latin text', () => {
    expect(linesOf(`<w:p>${run('aaa ')}${run('bbbbb')}${run('ccccc')}</w:p>`)).toEqual([
      'aaa ',
      'bbbbbccccc',
    ]);
  });

  test('a Latin word beside CJK stays whole while the CJK wraps freely', () => {
    // 玄黄ABCD宇 is bounded by ideograph|Latin seams on both sides of ABCD; no new
    // opportunity appears inside or beside the Latin word, so it wraps as one unit.
    expect(linesOf(`<w:p>${run('天地玄黄ABCD宇宙洪荒日月盈')}</w:p>`)).toEqual([
      '天地玄黄ABCD宇宙',
      '洪荒日月盈',
    ]);
  });
});
