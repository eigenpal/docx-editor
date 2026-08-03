// A clipboard payload that carries only `text/html`.
//
// The paste handler prevents the browser's default unconditionally, so returning early on
// a missing `text/plain` flavour meant those payloads pasted NOTHING, with no error and no
// fallback. The text is recovered instead — as text, never as structure.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { plainTextFromHtml, plainTextFromTransfer } from '../clipboard-plain-text.ts';
import { createClipboardHandlers } from '../surface-input.ts';
import type { PaginatedSurface } from '../paginated-surface-contract.ts';

/** A DataTransfer stand-in: happy-dom's does not carry arbitrary flavours reliably. */
const transfer = (flavours: Record<string, string>): DataTransfer =>
  ({ getData: (type: string) => flavours[type] ?? '' }) as unknown as DataTransfer;

describe('the text behind a clipboard payload', () => {
  test('text/plain wins whenever the payload carries it', () => {
    const data = transfer({ 'text/plain': 'chosen', 'text/html': '<p>ignored</p>' });
    expect(plainTextFromTransfer(data)).toBe('chosen');
  });

  test('an HTML-only payload pastes its text instead of nothing at all', () => {
    const data = transfer({ 'text/html': '<p>alpha</p>' });
    expect(plainTextFromTransfer(data)).toBe('alpha');
  });

  test('a payload with neither flavour is still empty', () => {
    expect(plainTextFromTransfer(transfer({}))).toBe('');
    expect(plainTextFromTransfer(null)).toBe('');
  });
});

describe('the paste handler', () => {
  const paste = (flavours: Record<string, string>) => {
    const inserted: string[] = [];
    let prevented = false;
    const handlers = createClipboardHandlers({} as PaginatedSurface, (text) => inserted.push(text));
    handlers.onPaste({
      clipboardData: transfer(flavours),
      preventDefault: () => {
        prevented = true;
      },
    } as unknown as ClipboardEvent);
    return { inserted, prevented };
  };

  test('an HTML-only payload reaches the document', () => {
    const { inserted } = paste({ 'text/html': '<p>alpha</p><p>beta</p>' });
    // Newlines, so the insert splits into real paragraphs rather than one run.
    expect(inserted).toEqual(['alpha\nbeta']);
  });

  test('the browser default is prevented either way, including on an empty payload', () => {
    expect(paste({ 'text/html': '<p>alpha</p>' }).prevented).toBe(true);
    const empty = paste({});
    expect(empty.prevented).toBe(true);
    expect(empty.inserted).toEqual([]);
  });

  test('a payload with both flavours still inserts the plain one verbatim', () => {
    const { inserted } = paste({
      'text/plain': '  spaced  text  ',
      'text/html': '<p>collapsed</p>',
    });
    expect(inserted).toEqual(['  spaced  text  ']);
  });
});

describe('the visible text of an HTML fragment', () => {
  test('block boundaries become newlines, so paste splits paragraphs', () => {
    expect(plainTextFromHtml('<p>one</p><p>two</p>')).toBe('one\ntwo');
    expect(plainTextFromHtml('alpha<br>beta')).toBe('alpha\nbeta');
  });

  test('table cells become tabs and rows newlines, like a copied cell range', () => {
    const html = '<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>';
    expect(plainTextFromHtml(html)).toBe('a\tb\nc\td');
  });

  test('script and style CONTENT never becomes pasted text', () => {
    const html = '<div>before<script>alert(1)</script><style>p{color:red}</style>after</div>';
    const text = plainTextFromHtml(html);
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toBe('beforeafter');
  });

  test('an unclosed script tag does not leak its body either', () => {
    expect(plainTextFromHtml('<div>keep<script>alert(1)')).toBe('keep');
  });

  test('comments are dropped, including tag-shaped text inside them', () => {
    expect(plainTextFromHtml('a<!-- <p>hidden</p> -->b')).toBe('ab');
  });

  test('entities decode only AFTER tags are gone, so markup cannot reassemble', () => {
    // The payload names a tag through entities. Decoding first would hand the tag
    // stripper live markup; decoding last leaves it as the literal text it always was.
    const text = plainTextFromHtml('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(text).toBe('<script>alert(1)</script>');
  });

  test('numeric and named references decode, and nonsense ones stay literal', () => {
    // `&nbsp;` stays a real U+00A0 rather than collapsing to a space.
    expect(plainTextFromHtml('<p>a&amp;b&#65;c&#x42;d&nbsp;e</p>')).toBe('a&bAcBd\u00a0e');
    expect(plainTextFromHtml('<p>&#x110000;</p>')).toBe('&#x110000;');
    expect(plainTextFromHtml('<p>&notareal;</p>')).toBe('&notareal;');
  });

  test('a lone surrogate reference never throws', () => {
    expect(() => plainTextFromHtml('<p>&#xD800;</p>')).not.toThrow();
  });

  test('a hostile oversized payload is bounded rather than dropped', () => {
    const huge = `<p>${'x'.repeat(3_000_000)}</p>`;
    const text = plainTextFromHtml(huge);
    expect(text.length).toBeGreaterThan(0);
    expect(text.length).toBeLessThanOrEqual(2_000_000);
  });

  test('no output ever carries an angle-bracketed tag through', () => {
    const html = '<p onclick="evil()">text<img src=x onerror=alert(1)></p>';
    expect(plainTextFromHtml(html)).toBe('text');
  });
});
