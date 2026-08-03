// Two things a table of contents and a Shift+Enter need, which the flow used to drop.
//
// `w:ptab` (ECMA-376 §17.3.3.16) is the ABSOLUTE-position tab. It is not `w:tab`: it states
// its own destination and leader instead of advancing to the next stop in `w:tabs`, so a
// paragraph that uses one declares no tab stops at all. Nothing modelled it, so it demoted
// to a generic element, contributed no advance, and a contents line rendered as
// "Chapter 1: Introduction1" — no gap, no dots.
//
// A TRAILING hard break used to close the only line there was and leave nothing after it,
// so the caret fell back to the end of the line the break had just ended.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import {
  caretAt,
  caretStops,
  hitTestSemantic,
  moveCaret,
  paragraphTextFromLayout,
} from '../semantic-interaction.ts';
import { paintSemanticLayout } from '../../output/semantic-paint.ts';
import type { ParagraphFragmentRecord } from '../semantic-records.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

const measurer = createFixedMeasurer(6, 14);
const lay = (body: string) => layoutSemanticDocument(load(body), 1, { measurer });

function paragraphs(layout: ReturnType<typeof lay>): ParagraphFragmentRecord[] {
  const found: ParagraphFragmentRecord[] = [];
  for (const page of layout.pages) {
    for (const fragment of page.fragments) if (fragment.kind === 'paragraph') found.push(fragment);
  }
  return found;
}

/** One contents line: text, a right-margin `w:ptab` with dot leader, then the page number. */
const CONTENTS =
  '<w:p><w:r><w:t>Chapter 1</w:t>' +
  '<w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/>' +
  '<w:t>7</w:t></w:r></w:p>';

describe('w:ptab lays out as an absolute-position tab', () => {
  const contents = CONTENTS;

  test('it advances to the right margin and carries its leader', () => {
    const fragment = paragraphs(lay(contents))[0]!;
    const line = fragment.lines[0]!;
    const tab = line.spans.find((span) => span.text === '\t')!;
    expect(tab).toBeDefined();
    expect(tab.tabLeader).toBe('dot');
    // The page number ends flush at the paragraph's right edge, which is what makes a
    // contents line read as one: text left, dots between, number right.
    const last = line.spans[line.spans.length - 1]!;
    expect(Math.round(last.box.x + last.box.width)).toBe(
      Math.round(fragment.box.x + fragment.box.width)
    );
    expect(tab.box.width).toBeGreaterThan(0);
  });

  test('it occupies NO model offset', () => {
    // The element is generic in the canonical tree and contributes nothing to the
    // paragraph's text. An advance that consumed an offset would put every offset after it
    // out of step with the store, which is how a tab ends up deleting the wrong character.
    const fragment = paragraphs(lay(contents))[0]!;
    const tab = fragment.lines[0]!.spans.find((span) => span.text === '\t')!;
    expect(tab.range.end).toBe(tab.range.start);
    // 'Chapter 1' + '7' — the ptab adds nothing.
    expect(fragment.lines[0]!.range.end).toBe('Chapter 17'.length);
  });

  test('a centre-aligned ptab lands at the column midpoint, and an unknown leader is none', () => {
    const fragment = paragraphs(
      lay(
        '<w:p><w:r><w:t>a</w:t>' +
          '<w:ptab w:alignment="center" w:relativeTo="margin" w:leader="bogus"/>' +
          '<w:t>b</w:t></w:r></w:p>'
      )
    )[0]!;
    const line = fragment.lines[0]!;
    const tab = line.spans.find((span) => span.text === '\t')!;
    expect(tab.tabLeader).toBeUndefined();
    const midpoint = fragment.box.x + fragment.box.width / 2;
    const after = line.spans[line.spans.length - 1]!;
    // The text following a centred stop straddles it.
    expect(after.box.x).toBeLessThanOrEqual(midpoint);
    expect(after.box.x + after.box.width).toBeGreaterThanOrEqual(midpoint - 1);
  });
});

describe('a w:ptab leader is PAINTED across the advance, not merely published', () => {
  // The layout assertions above prove the record carries `tabLeader`; they would all still
  // pass with a painter that draws nothing, and "Chapter 1                    7" with an
  // empty gap is the same broken contents line the record was meant to fix. These read the
  // DOM the surface actually shows. `w:tab` leaders have this coverage
  // (`tab-leaders-default-stop.test.ts`); `w:ptab` reaches paint through its own layout
  // path, so it needs its own.
  function painted(body: string): HTMLElement {
    const container = document.createElement('div');
    paintSemanticLayout(container, lay(body), { scale: 1 });
    return container;
  }

  function ptabSpan(body: string) {
    const line = paragraphs(lay(body))[0]!.lines[0]!;
    return line.spans.find((span) => span.text === '\t')!;
  }

  test('the dots are real glyphs, filling the reserved advance and clipped to it', () => {
    const container = painted(CONTENTS);
    const leader = container.querySelector<HTMLElement>('[data-docx-tab-leader]');
    expect(leader).not.toBeNull();
    // Dots, plural, and nothing but dots — an empty layer or a single glyph is the defect.
    expect(leader!.textContent!.length).toBeGreaterThan(1);
    expect(new Set(leader!.textContent!)).toEqual(new Set(['.']));

    // The repeat deliberately OVERFILLS, so the clip is what stops the dots at the stop.
    // Without it the run of dots would spill past the page number.
    const span = ptabSpan(CONTENTS);
    const fragment = paragraphs(lay(CONTENTS))[0]!;
    expect(leader!.style.overflow).toBe('hidden');
    expect(leader!.style.width).toBe(`${span.box.width}px`);
    expect(Number.parseFloat(leader!.style.left)).toBe(span.box.x - fragment.box.x);
    expect(Number.parseFloat(leader!.style.top)).toBe(fragment.lines[0]!.box.y - fragment.box.y);
  });

  test('the leader layer is furniture and carries NO model offset', () => {
    // Same contract the `w:tab` leader has: `dom-selection` reads a span's length from its
    // textContent, so a hundred dots inside an addressable span would put every offset
    // after the ptab out of step with the store — and a ptab occupies no offset at all.
    const container = painted(CONTENTS);
    const leader = container.querySelector<HTMLElement>('[data-docx-tab-leader]')!;
    expect(leader.getAttribute('aria-hidden')).toBe('true');
    expect(leader.getAttribute('contenteditable')).toBe('false');
    expect(leader.closest('[data-start]')).toBeNull();

    // The dots stay OUT of the addressable text: no painted span that carries a model
    // range may contain them, or every offset past the leader shifts by however many
    // glyphs the advance happened to fit.
    const addressable = [...container.querySelectorAll('[data-paragraph-id][data-start]')];
    expect(addressable.some((span) => span.contains(leader))).toBe(false);
    for (const span of addressable) expect(span.textContent).not.toContain('.');
    expect(addressable.map((span) => span.textContent).join('')).toContain('Chapter 1');
    expect(addressable.map((span) => span.textContent).join('')).toContain('7');
  });

  test('a ptab with no leader paints no layer at all', () => {
    const container = painted(
      '<w:p><w:r><w:t>a</w:t><w:ptab w:alignment="right" w:relativeTo="margin"/>' +
        '<w:t>b</w:t></w:r></w:p>'
    );
    expect(container.querySelectorAll('[data-docx-tab-leader]')).toHaveLength(0);
  });

  test('an unrecognised leader paints nothing rather than a stray glyph', () => {
    // `w:leader` comes out of the file. An unknown token must reach the glyph table and
    // miss, not reach `String.repeat` with whatever it said.
    const container = painted(
      '<w:p><w:r><w:t>a</w:t>' +
        '<w:ptab w:alignment="right" w:relativeTo="margin" w:leader="__proto__"/>' +
        '<w:t>b</w:t></w:r></w:p>'
    );
    expect(container.querySelectorAll('[data-docx-tab-leader]')).toHaveLength(0);
  });
});

describe('a trailing hard break opens a line to type on', () => {
  const trailing = '<w:p><w:r><w:t>hello</w:t><w:br/></w:r></w:p>';

  test('the paragraph gains an empty second line', () => {
    const fragment = paragraphs(lay(trailing))[0]!;
    expect(fragment.lines).toHaveLength(2);
    const second = fragment.lines[1]!;
    expect(second.spans).toHaveLength(0);
    expect(second.box.y).toBeGreaterThan(fragment.lines[0]!.box.y);
  });

  test('the caret after the break lands at the start of that line, not the end of the last', () => {
    const layout = lay(trailing);
    const fragment = paragraphs(layout)[0]!;
    const [first, second] = fragment.lines;
    // 'hello' + the break's own offset.
    const caret = caretAt(layout, { paragraphId: fragment.paragraphId, offset: 6 })!;
    expect(caret.lineId).toBe(second!.id);
    expect(caret.y).toBe(second!.box.y);
    expect(caret.y).not.toBe(first!.box.y);
  });

  test('the same rule holds when text FOLLOWS the break', () => {
    const layout = lay('<w:p><w:r><w:t>hello</w:t><w:br/><w:t>world</w:t></w:r></w:p>');
    const fragment = paragraphs(layout)[0]!;
    const second = fragment.lines[1]!;
    const caret = caretAt(layout, { paragraphId: fragment.paragraphId, offset: 6 })!;
    // Offset 6 is both the first line's end and the second's start; the break is what
    // ended the first, so it belongs to the second.
    expect(caret.lineId).toBe(second.id);
    expect(caret.x).toBe(second.box.x);
  });

  test('a SOFT wrap still answers with the first line — the offset is genuinely shared', () => {
    // The rule is scoped to hard breaks on purpose: at a wrap point both answers are
    // defensible and the end of the visual line is the conventional one.
    const words = Array.from({ length: 60 }, (_, index) => `w${index}`).join(' ');
    const layout = lay(`<w:p><w:r><w:t>${words}</w:t></w:r></w:p>`);
    const fragment = paragraphs(layout)[0]!;
    expect(fragment.lines.length).toBeGreaterThan(1);
    const boundary = fragment.lines[0]!.range.end;
    const caret = caretAt(layout, { paragraphId: fragment.paragraphId, offset: boundary })!;
    expect(caret.lineId).toBe(fragment.lines[0]!.id);
  });
});

describe('the lanes agree about which line owns a shared position', () => {
  const trailing = '<w:p><w:r><w:t>hello</w:t><w:br/></w:r></w:p>';

  test('caretStops puts the stop on the line the break OPENED, like caretAt', () => {
    // The split this pins: `caretAt` learned that a hard break hands the position to the
    // next line, and `caretStops` — which every arrow key resolves through — did not. The
    // caret painted on line 2 while Home, End and Up all believed it was on line 1, and the
    // empty line a trailing Shift+Enter opens had no stop at all, so Down skipped it.
    const layout = lay(trailing);
    const fragment = paragraphs(layout)[0]!;
    const second = fragment.lines[1]!;
    const stop = caretStops(layout).find(
      (entry) => entry.position.paragraphId === fragment.paragraphId && entry.position.offset === 6
    )!;
    expect(stop.lineId).toBe(second.id);
    expect(stop.lineId).toBe(caretAt(layout, stop.position)!.lineId);
    expect(stop.y).toBe(caretAt(layout, stop.position)!.y);
    // Emitted exactly once — the line the break ended must not publish it too.
    const all = caretStops(layout).filter(
      (entry) => entry.position.paragraphId === fragment.paragraphId && entry.position.offset === 6
    );
    expect(all).toHaveLength(1);
  });

  test('Home on the opened line stays on it, and Down reaches it', () => {
    const layout = lay(trailing);
    const fragment = paragraphs(layout)[0]!;
    const at = { paragraphId: fragment.paragraphId, offset: 6 };
    expect(moveCaret(layout, at, 'lineStart')!.position.offset).toBe(6);
    // Down from the first line lands on the empty line, not past the paragraph.
    const down = moveCaret(layout, { paragraphId: fragment.paragraphId, offset: 2 }, 'down');
    expect(down!.position.offset).toBe(6);
  });

  test('a click in the right margin of the break line stays on that line', () => {
    // `caretAt` re-homes the post-break offset to the next line, so a hit test that clamped
    // to the line END dropped the caret a row below the click.
    const layout = lay('<w:p><w:r><w:t>hello</w:t><w:br/><w:t>world</w:t></w:r></w:p>');
    const fragment = paragraphs(layout)[0]!;
    const first = fragment.lines[0]!;
    const hit = hitTestSemantic(layout, { x: 400, y: first.box.y + 1, pageIndex: 0 })!;
    // Before the break — the position after it belongs to the line below.
    expect(hit.position.offset).toBe(5);
    expect(caretAt(layout, hit.position)!.lineId).toBe(first.id);
  });
});

describe('a w:ptab owns no model offsets', () => {
  test('the reconstructed paragraph text matches the model, even when a ptab ends it', () => {
    // `paragraphTextFromLayout` IS the surface's `paragraphTextOf`, so a phantom character
    // here puts the deletion range, the selection clamp and the word walk past the end of
    // the paragraph — a selected cell would refuse to clear with `offset-out-of-range`.
    const layout = lay('<w:p><w:r><w:t>a</w:t><w:ptab w:alignment="right"/></w:r></w:p>');
    const fragment = paragraphs(layout)[0]!;
    expect(paragraphTextFromLayout(layout, fragment.paragraphId)).toBe('a');
  });

  test('it honours w:relativeTo="margin" over the paragraph indent', () => {
    // Reading the attribute and then ignoring it left the page number short of the margin
    // by the width of the indent.
    const fragment = paragraphs(
      lay(
        '<w:p><w:pPr><w:ind w:left="1440" w:right="1440"/></w:pPr>' +
          '<w:r><w:t>x</w:t><w:ptab w:alignment="right" w:relativeTo="margin"/><w:t>9</w:t></w:r></w:p>'
      )
    )[0]!;
    const line = fragment.lines[0]!;
    const last = line.spans[line.spans.length - 1]!;
    // The indent is 72pt each side; margin-relative must clear it.
    expect(last.box.x + last.box.width).toBeGreaterThan(fragment.box.x + fragment.box.width);
  });

  test('a left-aligned ptab still advances rather than running the glyphs together', () => {
    // Its destination is at or behind the caret, and it is also the fallback for a
    // malformed `w:alignment` — the run-together text this element exists to prevent.
    const fragment = paragraphs(
      lay(
        '<w:p><w:r><w:t>a</w:t><w:ptab w:alignment="left" w:relativeTo="indent"/><w:t>b</w:t></w:r></w:p>'
      )
    )[0]!;
    const tab = fragment.lines[0]!.spans.find((span) => span.text === '\t')!;
    expect(tab.box.width).toBeGreaterThan(0);
  });
});
