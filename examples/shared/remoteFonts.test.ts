// Fetching a family the machine lacks (task 7.7, link three).
//
// Most of these are about what is REFUSED. A family name comes out of the document, so a
// request tells a third party something about the document — the rule is no zero-click
// external fetch from a file, and a font request is exactly that.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { remoteFontUrl, requestRemoteFont } from './remoteFonts.ts';

describe('nothing is requested unless the host opted in', () => {
  test('disabled means no URL at all, whatever the family', () => {
    expect(remoteFontUrl('Roboto', { enabled: false })).toBeNull();
  });

  test('disabled means no element is appended either', () => {
    const before = document.querySelectorAll('link[rel="stylesheet"]').length;
    expect(requestRemoteFont('Roboto', { enabled: false })).toBe(false);
    expect(document.querySelectorAll('link[rel="stylesheet"]').length).toBe(before);
  });
});

describe('a hostile or pointless family is refused, not encoded', () => {
  const on = { enabled: true };

  test('a name that could reshape the URL is refused outright', () => {
    // Encoding it would only make the request quieter; such a name has no business
    // becoming a URL.
    expect(remoteFontUrl('Roboto"/><script>', on)).toBeNull();
    expect(remoteFontUrl('../../etc/passwd', on)).toBeNull();
    expect(remoteFontUrl('Roboto&family=Evil', on)).toBeNull();
    expect(remoteFontUrl('a'.repeat(200), on)).toBeNull();
    expect(remoteFontUrl('', on)).toBeNull();
  });

  test('generic families are never requested, since asking only leaks', () => {
    for (const generic of ['serif', 'Sans-Serif', 'monospace', 'system-ui']) {
      expect(remoteFontUrl(generic, on)).toBeNull();
    }
  });

  test('a valid family produces a provider stylesheet URL with swap', () => {
    const url = remoteFontUrl('Open Sans', on)!;
    expect(url.startsWith('https://fonts.googleapis.com/css2?')).toBe(true);
    expect(url).toContain('display=swap');
    expect(url).toContain('wght%40400%3B700');
  });

  test('weights are bounded and de-duplicated', () => {
    expect(remoteFontUrl('Roboto', { enabled: true, weights: [400, 400, 700] })).toContain(
      'wght%40400%3B700'
    );
    // Out-of-range weights are dropped; if nothing survives, nothing is requested.
    expect(remoteFontUrl('Roboto', { enabled: true, weights: [0, 5000] })).toBeNull();
  });
});

describe('a request is made once, and made privately', () => {
  test('the same family is not requested twice', () => {
    const requested = new Set<string>();
    const options = { enabled: true, requested };
    expect(requestRemoteFont('Lato', options)).toBe(true);
    const after = document.querySelectorAll('link[rel="stylesheet"]').length;
    expect(requestRemoteFont('lato', options)).toBe(true);
    expect(document.querySelectorAll('link[rel="stylesheet"]').length).toBe(after);
  });

  test('the request carries no credentials and no referrer', () => {
    const requested = new Set<string>();
    requestRemoteFont('Merriweather', { enabled: true, requested });
    const link = [...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].pop()!;
    expect(link.crossOrigin).toBe('anonymous');
    expect(link.referrerPolicy).toBe('no-referrer');
  });
});
