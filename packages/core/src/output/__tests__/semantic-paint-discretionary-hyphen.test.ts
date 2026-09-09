import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import type {
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import { DEFAULT_RUN_STYLE } from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';

const SINGLE_UNDERLINE = Object.freeze({ variant: 'single', color: null });

function hyphenatedSpan(
  text: string,
  options: {
    hyphenWidthPt?: number;
    underline?: StyleSpanRecord['style']['underline'];
    link?: StyleSpanRecord['link'];
    prefixWidthPt?: number;
  } = {}
): StyleSpanRecord {
  const prefixWidth = options.prefixWidthPt ?? text.length * 6;
  const hyphenWidth = options.hyphenWidthPt ?? 6;
  return Object.freeze({
    range: Object.freeze({ paragraphId: 'p1', start: 0, end: text.length }),
    text,
    props: Object.freeze([]),
    style: Object.freeze({
      ...DEFAULT_RUN_STYLE,
      fontFamily: 'Arial',
      fontSizePt: 11,
      ...(options.underline ? { underline: options.underline } : {}),
    }),
    box: Object.freeze({
      x: 0,
      y: 0,
      width: prefixWidth + hyphenWidth,
      height: 14,
    }),
    ...(options.link ? { link: options.link } : {}),
    ...(options.hyphenWidthPt === 0
      ? {}
      : { discretionaryHyphen: Object.freeze({ widthPt: hyphenWidth }) }),
  }) as StyleSpanRecord;
}

function layoutOfSpan(span: StyleSpanRecord): SemanticLayout {
  const lineBox = Object.freeze({ x: 72, y: 72, width: 468, height: 14 });
  const fragment = Object.freeze({
    kind: 'paragraph',
    id: 'p1:f0',
    paragraphId: 'p1',
    fragmentIndex: 0,
    range: Object.freeze({ paragraphId: 'p1', start: 0, end: span.range.end }),
    props: Object.freeze([]),
    styleId: null,
    outlineLevel: null,
    alignment: 'left',
    spacing: Object.freeze({ before: 0, after: 0 }),
    indent: Object.freeze({ left: 0, right: 0, firstLine: 0, hanging: 0 }),
    tabStops: Object.freeze({ stops: Object.freeze([]), defaultIntervalPt: 36 }),
    lines: Object.freeze([
      Object.freeze({
        id: 'p1:line-0',
        range: Object.freeze({ paragraphId: 'p1', start: 0, end: span.range.end }),
        spans: Object.freeze([span]),
        box: lineBox,
        contentX: lineBox.x,
        baseline: 10,
        leading: 0,
      }),
    ]),
    box: lineBox,
  }) as ParagraphFragmentRecord;
  const pageRecord = Object.freeze({
    id: 'page-0',
    index: 0,
    box: Object.freeze({ x: 0, y: 0, width: 612, height: 792 }),
    contentBox: Object.freeze({ x: 72, y: 72, width: 468, height: 648 }),
    fragments: Object.freeze([fragment]),
  }) as PageRecord;
  return Object.freeze({ revision: 1, pages: Object.freeze([pageRecord]) });
}

function paintSpan(span: StyleSpanRecord): HTMLElement {
  const container = document.createElement('div');
  paintSemanticLayout(container, layoutOfSpan(span), { scale: 1, ariaHidden: false });
  return container;
}

describe('discretionary hyphen browser paint', () => {
  test('paints a layout-only hyphen after the span with no model address', () => {
    const container = paintSpan(hyphenatedSpan('citi'));
    const textRun = container.querySelector('.layout-run-text')!;
    const hyphen = container.querySelector('[data-docx-discretionary-hyphen]')!;

    expect(textRun.textContent).toBe('citi');
    expect(hyphen.textContent).toBe('-');
    expect((textRun as HTMLElement).dataset.start).toBe('0');
    expect((textRun as HTMLElement).dataset.end).toBe('4');
    expect((hyphen as HTMLElement).dataset.paragraphId).toBeUndefined();
    expect((hyphen as HTMLElement).dataset.start).toBeUndefined();
    expect(hyphen.getAttribute('aria-hidden')).toBe('true');
    expect(hyphen.getAttribute('contenteditable')).toBe('false');
    expect(Number.parseFloat((hyphen as HTMLElement).style.width)).toBe(6);
  });

  test('emits no hyphen furniture when the property is absent', () => {
    const plain = Object.freeze({
      range: Object.freeze({ paragraphId: 'p1', start: 0, end: 5 }),
      text: 'plain',
      props: Object.freeze([]),
      style: Object.freeze({ ...DEFAULT_RUN_STYLE, fontFamily: 'Arial', fontSizePt: 11 }),
      box: Object.freeze({ x: 0, y: 0, width: 30, height: 14 }),
    }) as StyleSpanRecord;
    const container = paintSpan(plain);
    expect(container.querySelector('[data-docx-discretionary-hyphen]')).toBeNull();
    expect(container.querySelector('.layout-run-text')!.textContent).toBe('plain');
  });

  test('inherits underline on the hyphen like Word', () => {
    const container = paintSpan(hyphenatedSpan('citi', { underline: SINGLE_UNDERLINE }));
    const hyphen = container.querySelector('[data-docx-discretionary-hyphen]') as HTMLElement;
    const deco =
      hyphen.querySelector('[data-docx-deco="underline"]') ??
      (hyphen.style.textDecorationLine === 'underline' ? hyphen : null);
    expect(deco).not.toBeNull();
  });

  test('a linked prefix keeps the hyphen inside the anchor without a source range', () => {
    const container = paintSpan(
      hyphenatedSpan('link', {
        link: Object.freeze({
          id: 'hl1',
          kind: 'external',
          href: 'https://example.com',
        }),
      })
    );
    const anchor = container.querySelector('a.docx-hyperlink')!;
    const hyphen = anchor.querySelector('[data-docx-discretionary-hyphen]')!;
    const textRun = anchor.querySelector('[data-paragraph-id]')!;

    expect(anchor.textContent).toBe('link-');
    expect(hyphen).not.toBeNull();
    expect((hyphen as HTMLElement).dataset.paragraphId).toBeUndefined();
    expect((textRun as HTMLElement).dataset.end).toBe('4');
  });
});
