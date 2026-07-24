// Bounded clipboard/drop input policy unit tests (interactive-paginated-editing 4.5).

import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import { Slice, Fragment } from 'prosemirror-model';
import { docSchema } from '../src/schema.ts';
import {
  INPUT_POLICY_LIMITS,
  boundClipboardHtml,
  boundClipboardText,
  decodeHtmlCharacterReferences,
  decodePercentEncoding,
  normalizeUntrustedUrl,
  scanUntrustedUrl,
  scanUntrustedClipboardHtml,
  rejectClipboardDataTransfer,
  rejectDropDataTransfer,
  validatePastedSlice,
} from '../src/input-policy.ts';

describe('input policy bounds', () => {
  test('rejects oversized plain text before parsing', () => {
    const huge = 'a'.repeat(INPUT_POLICY_LIMITS.maxPlainTextChars + 1);
    const result = boundClipboardText(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe('oversizedPayload');
  });

  test('rejects oversized HTML before parsing', () => {
    const huge = '<p>' + 'a'.repeat(INPUT_POLICY_LIMITS.maxHtmlChars) + '</p>';
    const result = boundClipboardHtml(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.rejection.code).toBe('oversizedPayload');
  });

  test('rejects remote resource-bearing tags', () => {
    expect(scanUntrustedClipboardHtml('<p>ok</p><img src="https://example.com/x.png">')?.code).toBe('unsafeResource');
    expect(scanUntrustedClipboardHtml('<video src="https://example.com/v.mp4"></video>')?.code).toBe('unsafeResource');
    expect(scanUntrustedClipboardHtml('<source src="x">')?.code).toBe('unsafeResource');
  });

  test('rejects forged capability markup', () => {
    expect(scanUntrustedClipboardHtml('<div class="docx-block-embed">x</div>')?.code).toBe('capabilityBoundary');
    expect(scanUntrustedClipboardHtml('<span data-raw-rpr="evil">x</span>')?.code).toBe('capabilityBoundary');
  });

  test('rejects inline event-handler attributes on allowed tags', () => {
    expect(scanUntrustedClipboardHtml('<p onclick="alert(1)">x</p>')?.code).toBe('unsafeResource');
    expect(scanUntrustedClipboardHtml('<span onmouseover="evil()">x</span>')?.code).toBe('unsafeResource');
    expect(scanUntrustedClipboardHtml('<a href="https://example.com" onfocus="evil()">x</a>')?.code).toBe('unsafeResource');
  });

  test('rejects active and foreign-namespace markup', () => {
    expect(scanUntrustedClipboardHtml('<svg><text>x</text></svg>')?.code).toBe('unsafeResource');
    expect(scanUntrustedClipboardHtml('<math><mi>x</mi></math>')?.code).toBe('unsafeResource');
    expect(scanUntrustedClipboardHtml('<foreignobject>x</foreignobject>')?.code).toBe('unsafeResource');
  });

  test('rejects entity-encoded javascript URLs', () => {
    expect(scanUntrustedUrl('&#106;&#97;&#118;&#97;script:alert(1)')?.code).toBe('unsafeResource');
    expect(scanUntrustedUrl('&#x6a;&#x61;&#x76;&#x61;script:alert(1)')?.code).toBe('unsafeResource');
  });

  test('rejects whitespace and control-split scheme obfuscation', () => {
    expect(scanUntrustedUrl('java\nscript:alert(1)')?.code).toBe('unsafeResource');
    expect(scanUntrustedUrl('java\tscript:alert(1)')?.code).toBe('unsafeResource');
    expect(scanUntrustedUrl('java script:alert(1)')?.code).toBe('unsafeResource');
  });

  test('rejects percent-encoded and backslash-obfuscated dangerous schemes', () => {
    expect(scanUntrustedUrl('j%61vascript:alert(1)')?.code).toBe('unsafeResource');
    expect(scanUntrustedUrl('j%2561vascript:alert(1)')?.code).toBe('unsafeResource');
    expect(scanUntrustedUrl('data:text/html,evil')?.code).toBe('unsafeResource');
    expect(scanUntrustedUrl('vbscript:msgbox(1)')?.code).toBe('unsafeResource');
  });

  test('allows safe http and mailto links in HTML attributes', () => {
    expect(scanUntrustedUrl('https://example.com/path')).toBeNull();
    expect(scanUntrustedUrl('mailto:user@example.com')).toBeNull();
    expect(
      scanUntrustedClipboardHtml('<a href="https://example.com">safe</a><a href="mailto:a@b.c">m</a>'),
    ).toBeNull();
  });

  test('decodeHtmlCharacterReferences is bounded and linear', () => {
    expect(decodeHtmlCharacterReferences('&#65;&#66;')).toBe('AB');
    expect(decodeHtmlCharacterReferences('&amp;lt;')).toBe('&lt;');
    expect(decodeHtmlCharacterReferences('a'.repeat(INPUT_POLICY_LIMITS.maxDecodedUrlChars + 1))).toBeNull();
  });

  test('decodePercentEncoding normalizes nested encodings', () => {
    expect(decodePercentEncoding('%41%42')).toBe('AB');
    expect(decodePercentEncoding('%2541')).toBe('A');
  });

  test('normalizeUntrustedUrl strips backslashes before scheme checks', () => {
    expect(normalizeUntrustedUrl('java\\script:alert(1)')).toBe('javascript:alert(1)');
    expect(scanUntrustedUrl('java\\script:alert(1)')?.code).toBe('unsafeResource');
  });

  test('rejects file payloads on clipboard', () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'evil.docx', { type: 'application/octet-stream' }));
    expect(rejectClipboardDataTransfer(dt)?.code).toBe('filePayload');
  });

  test('rejects file payloads on drop', () => {
    const dt = new DataTransfer();
    dt.items.add(new File(['x'], 'photo.png', { type: 'image/png' }));
    expect(rejectDropDataTransfer(dt)?.code).toBe('filePayload');
  });

  test('rejects pasted slices with blockEmbed atoms (capability boundary)', () => {
    const embed = docSchema.node('blockEmbed', { semId: 'tbl', kind: 'table' });
    const slice = new Slice(Fragment.from(embed), 0, 0);
    expect(validatePastedSlice(slice, docSchema)?.code).toBe('capabilityBoundary');
  });

  test('rejects pasted slices exceeding block budget', () => {
    const paras = Array.from({ length: INPUT_POLICY_LIMITS.maxPastedBlocks + 1 }, (_, i) =>
      docSchema.node('paragraph', { semId: `p-${i}` }, docSchema.text('x')),
    );
    const slice = new Slice(Fragment.fromArray(paras), 0, 0);
    expect(validatePastedSlice(slice, docSchema)?.code).toBe('oversizedPayload');
  });

  test('accepts bounded paragraph/text slices', () => {
    const slice = new Slice(
      Fragment.from(docSchema.node('paragraph', { semId: null }, docSchema.text('hello'))),
      0,
      0,
    );
    expect(validatePastedSlice(slice, docSchema)).toBeNull();
  });
});
