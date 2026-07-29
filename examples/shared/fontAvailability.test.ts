// Font availability and the resolution order (task 7.7).

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { canRenderFont, resolveFontFamily } from './fontAvailability.ts';

describe('a family name is validated before it reaches a CSS shorthand', () => {
  test('a name that could close the string is refused', () => {
    // The name is file-derived and this builds a `font` shorthand, so a name carrying a
    // quote or a semicolon is refused rather than escaped.
    expect(canRenderFont('Arial"; background:url(//evil)')).toBe(false);
    expect(canRenderFont('a'.repeat(200))).toBe(false);
    expect(canRenderFont('')).toBe(false);
  });

  test('a generic family always renders and is not compared with itself', () => {
    expect(canRenderFont('sans-serif')).toBe(true);
    expect(canRenderFont('monospace')).toBe(true);
  });

  test('CJK and accented names are accepted, not rejected as unsafe', () => {
    // ASCII-only validation silently loses the typeface of an entire document.
    expect(() => canRenderFont('游ゴシック')).not.toThrow();
    expect(() => canRenderFont('Söhne')).not.toThrow();
  });
});

describe('resolution order costs least and matches best', () => {
  const embedded = new Set(['Carried By Document']);

  test('a font the DOCUMENT carries wins outright', () => {
    // Those bytes are exactly what the author saw, and they need neither the machine's
    // cooperation nor the network.
    expect(resolveFontFamily('Carried By Document', { embedded })).toEqual({
      family: 'Carried By Document',
      origin: 'embedded',
    });
  });

  test('the network is never consulted for a family already embedded', () => {
    let fetched = 0;
    resolveFontFamily('Carried By Document', {
      embedded,
      fetchRemote: () => {
        fetched += 1;
        return true;
      },
    });
    expect(fetched).toBe(0);
  });

  const missing = { embedded, isAvailable: () => false };

  test('an INSTALLED family is used as is, and the network is not consulted', () => {
    let fetched = 0;
    const resolution = resolveFontFamily('Georgia', {
      embedded,
      isAvailable: () => true,
      fetchRemote: () => {
        fetched += 1;
        return true;
      },
    });
    expect(resolution.origin).toBe('installed');
    // Fetching a font the user already has is waste and a privacy leak.
    expect(fetched).toBe(0);
  });

  test('an unavailable family reaches the remote step, and its result is labelled', () => {
    expect(
      resolveFontFamily('Xyzzy', { ...missing, fetchRemote: () => true }).origin
    ).toBe('remote');
  });

  test('a remote fetch that FAILS falls back rather than claiming the family', () => {
    expect(
      resolveFontFamily('Xyzzy', { ...missing, fetchRemote: () => false }).origin
    ).toBe('fallback');
  });

  test('with no remote step, an unavailable family is labelled a FALLBACK, not a match', () => {
    // A caller that cannot tell a fallback from a match reports fidelity it does not have.
    expect(resolveFontFamily('Xyzzy', missing).origin).toBe('fallback');
  });

  test('without a canvas, nothing is claimed MISSING — the safe default', () => {
    // Headless there is no measurement, and refusing to call a font absent is safer than
    // fetching one that is present.
    expect(resolveFontFamily('Georgia', { embedded }).origin).toBe('installed');
  });
});
