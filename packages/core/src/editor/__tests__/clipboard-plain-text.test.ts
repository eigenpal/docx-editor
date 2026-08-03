// A clipboard payload that carries only `text/html`.
//
// The paste handler prevents the browser's default unconditionally, so returning early on
// a missing `text/plain` flavour meant those payloads pasted NOTHING, with no error and no
// fallback. The text is recovered instead — as text, never as structure.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import {
  insertableText,
  plainTextFromHtml,
  plainTextFromTransfer,
} from '../clipboard-plain-text.ts';
import { isValidXmlText } from '../../store/package/sinks.ts';
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

describe('making pasted text insertable', () => {
  // Run text is serialized to XML and the store validates it, so ONE illegal character
  // rejects the op — and one rejected op vetoes the transaction, which is why a paste
  // carrying a page break used to do nothing at all rather than partially land.

  test('a page break becomes a paragraph break instead of killing the paste', () => {
    expect(insertableText('alpha\fbeta')).toBe('alpha\nbeta');
  });

  test('the engine can paste back what it copied across a page break', () => {
    // `selectedText()` writes U+000C for a page break, so Select All + Copy + Paste fed
    // this exact shape straight back in and the whole paste was refused.
    const copied = 'page one\n\fpage two';
    const insertable = insertableText(copied);
    expect(isValidXmlText(insertable)).toBe(true);
    expect(insertable.split('\n')).toEqual(['page one', '', 'page two']);
  });

  test('CRLF and a lone CR still collapse to one paragraph break', () => {
    expect(insertableText('a\r\nb\rc')).toBe('a\nb\nc');
  });

  test('tab, newline and ordinary text survive untouched', () => {
    expect(insertableText('a\tb\nc')).toBe('a\tb\nc');
  });

  test('every other control character is dropped rather than refused', () => {
    expect(insertableText('a\u0001b\u0000c\u001fd')).toBe('abcd');
    expect(insertableText('a\ufffeb\uffffc')).toBe('abc');
  });

  test('a valid surrogate pair survives and a lone surrogate is dropped', () => {
    expect(insertableText('a\u{1F600}b')).toBe('a\u{1F600}b');
    expect(insertableText('a\ud800b')).toBe('ab');
    expect(insertableText('a\udc00b')).toBe('ab');
    expect(insertableText('a\ud800')).toBe('a');
  });

  test('whatever it returns is always something the store will accept', () => {
    const hostile = 'x\f\u0001\ud800y\uffff\u{1F600}\r\n\tz\udfff';
    expect(isValidXmlText(insertableText(hostile))).toBe(true);
    // …and the guard is meaningful: the raw payload is refused.
    expect(isValidXmlText(hostile)).toBe(false);
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
