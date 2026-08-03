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

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlPart } from '@docx-editor.dev/core-contract/store';
import { createFixedMeasurer, layoutSemanticDocument } from '../semantic-layout.ts';
import { caretAt } from '../semantic-interaction.ts';
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

describe('w:ptab lays out as an absolute-position tab', () => {
  const contents =
    '<w:p><w:r><w:t>Chapter 1</w:t>' +
    '<w:ptab w:alignment="right" w:relativeTo="margin" w:leader="dot"/>' +
    '<w:t>7</w:t></w:r></w:p>';

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
