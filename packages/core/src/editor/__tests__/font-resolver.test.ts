// The mark that separates an on-demand resolver from a zero-argument loader, and the
// list-of-origins composition both adapters build their font hooks on.
//
// The mark exists because the two are the same TYPE — `() => X` is assignable to
// `(request) => X` — and are called differently, so getting them mixed up is a runtime
// throw rather than a compile error. What is pinned here is that the mark survives, that
// an unmarked function reads as a loader, and that composition is first-wins in LIST
// order rather than in the order the origins happened to resolve.

import { describe, expect, test } from 'bun:test';
import {
  FONT_RESOLVER_BRAND,
  composeFontOrigins,
  defineFontResolver,
  isFontResolver,
} from '../font-resolver.ts';
import type { FontOrigin } from '../font-resolver.ts';
import type { FontConfigurationFragment, FontResolutionRequest } from '../font-composition.ts';
import type { FontSource } from '@docx-editor.dev/core/contracts/editor';

const REQUEST: FontResolutionRequest = {
  families: ['Calibri', 'Montserrat'],
  defaultFamily: 'Calibri',
};

function source(family: string, id: string): FontSource {
  return {
    request: { family, weight: 400, style: 'normal' },
    id,
    bytes: new Uint8Array([0]),
    hash: `sha256:${id}`,
    faceIndex: 0,
  };
}

describe('the resolver mark', () => {
  test('a marked function is a resolver and stays the same object', () => {
    const inner = async () => ({ sources: [] });
    const marked = defineFontResolver(inner);

    expect(marked).toBe(inner);
    expect(isFontResolver(marked)).toBe(true);
  });

  test('an unmarked function reads as a loader, which is the safe way to be wrong', () => {
    expect(isFontResolver(async () => ({ sources: [] }))).toBe(false);
    expect(isFontResolver({ sources: [] })).toBe(false);
    expect(isFontResolver(undefined)).toBe(false);
  });

  test('the mark is invisible to enumeration and to the spread a host might write', () => {
    const marked = defineFontResolver(async () => ({ sources: [] }));

    expect(Object.keys(marked)).toEqual([]);
    expect(Object.getOwnPropertySymbols({ ...marked })).not.toContain(FONT_RESOLVER_BRAND);
  });

  test('the mark is the registered symbol, so a second module copy still reads it', () => {
    const marked = defineFontResolver(async () => ({ sources: [] }));
    const rediscovered = Symbol.for('docx-editor.dev/font-resolver');

    expect(rediscovered).toBe(FONT_RESOLVER_BRAND);
    expect((marked as unknown as Record<symbol, unknown>)[rediscovered]).toBe(true);
  });
});

describe('composeFontOrigins', () => {
  test('merges first-wins in LIST order, however long an origin takes to answer', async () => {
    const slowFirst = defineFontResolver(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { sources: [source('Calibri', 'first')] };
    });
    const fastSecond: FontOrigin = { sources: [source('Calibri', 'second')] };

    // Both cover the same face, so exactly one of them can appear and which one is the
    // whole precedence rule. Reversed, the same two origins must give the other answer —
    // an implementation that merged in some other order would pass one of these and fail
    // the other.
    expect(
      (await composeFontOrigins([slowFirst, fastSecond], REQUEST))?.sources?.map((e) => e.id)
    ).toEqual(['first']);
    expect(
      (await composeFontOrigins([fastSecond, slowFirst], REQUEST))?.sources?.map((e) => e.id)
    ).toEqual(['second']);
  });

  test('tells a later origin which families an earlier one already answered for', async () => {
    const seen: FontResolutionRequest[] = [];
    const first = defineFontResolver(async () => ({
      // Both halves: the face that was loaded, and the document name it stands in for.
      sources: [source('Carlito', 'packaged')],
      substitutions: [
        {
          from: { family: 'Calibri', weight: 400, style: 'normal' as const },
          to: { family: 'Carlito', weight: 400, style: 'normal' as const },
        },
      ],
    }));
    const second = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [] };
    });

    await composeFontOrigins([first, second], REQUEST);

    expect(seen).toHaveLength(1);
    expect([...(seen[0]!.resolvedFamilies ?? [])].sort()).toEqual(['Calibri', 'Carlito']);
    // Everything else about the request is untouched.
    expect(seen[0]!.families).toBe(REQUEST.families);
    expect(seen[0]!.defaultFamily).toBe(REQUEST.defaultFamily);
  });

  test('the FIRST origin is asked the request as it came, with nothing marked resolved', async () => {
    const seen: FontResolutionRequest[] = [];
    const record = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return undefined;
    });

    await composeFontOrigins([record], REQUEST);

    expect(seen).toEqual([REQUEST]);
    expect(seen[0]!.resolvedFamilies).toBeUndefined();
  });

  test('an origin that answered nothing does not narrow the next one', async () => {
    const seen: FontResolutionRequest[] = [];
    const empty = defineFontResolver(async () => undefined);
    const record = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [] };
    });

    await composeFontOrigins([empty, record], REQUEST);

    expect(seen[0]!.resolvedFamilies).toBeUndefined();
  });

  test('carries NO epoch, so the engine stamps the load sequence', async () => {
    const merged = await composeFontOrigins([{ sources: [source('Calibri', 'one')] }], REQUEST);

    expect(merged).toBeDefined();
    expect('epoch' in (merged as object)).toBe(false);
  });

  test('an empty list, and a list that contributes nothing, both answer undefined', async () => {
    expect(await composeFontOrigins([], REQUEST)).toBeUndefined();
    expect(await composeFontOrigins([undefined, undefined], REQUEST)).toBeUndefined();
    expect(
      await composeFontOrigins([defineFontResolver(async () => undefined)], REQUEST)
    ).toBeUndefined();
  });

  test('composes rather than concatenates: a face supplied directly drops its stand-in', async () => {
    const direct: FontConfigurationFragment = { sources: [source('Calibri', 'real-calibri')] };
    const substituting: FontConfigurationFragment = {
      substitutions: [
        {
          from: { family: 'Calibri', weight: 400, style: 'normal' },
          to: { family: 'Carlito', weight: 400, style: 'normal' },
        },
      ],
    };

    // Either order: the drop rule is about the composition as a whole, not about which
    // origin was listed first. A concatenating implementation keeps the substitution and
    // the resource snapshot then consults it BEFORE the real bytes.
    for (const origins of [
      [direct, substituting],
      [substituting, direct],
    ]) {
      const merged = await composeFontOrigins(origins, REQUEST);
      expect(merged?.sources?.map((entry) => entry.id)).toEqual(['real-calibri']);
      expect(merged?.substitutions ?? []).toHaveLength(0);
    }
  });

  test('a promise origin resolves like any other', async () => {
    const merged = await composeFontOrigins(
      [Promise.resolve({ sources: [source('Cambria', 'awaited')] })],
      REQUEST
    );

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['awaited']);
  });
});
