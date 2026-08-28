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
  FONT_RESOLVER_MARK_KEY,
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

    // Both halves, both non-enumerable. `Object.keys` alone would pass on a symbol-only
    // mark whatever its descriptor said, so the spread check is what carries the symbol
    // half and `Object.keys` carries the string half.
    expect(Object.getOwnPropertySymbols({ ...marked })).not.toContain(FONT_RESOLVER_BRAND);
    expect(Object.keys(marked)).toEqual([]);
    expect(Object.keys({ ...marked })).toEqual([]);
  });

  test('both halves of the mark are really set, so the TYPE is not lying', () => {
    const marked = defineFontResolver(async () => ({ sources: [] }));

    expect((marked as unknown as Record<symbol, unknown>)[FONT_RESOLVER_BRAND]).toBe(true);
    // The string half is what `MarkedFontResolver` claims in the type and what lets
    // `@docx-editor.dev/fonts` declare the same mark without importing from the engine.
    expect(marked[FONT_RESOLVER_MARK_KEY]).toBe(true);
    expect(FONT_RESOLVER_MARK_KEY).toBe('docx-editor.dev/font-resolver');
  });

  test('refuses a frozen function rather than returning it unmarked', () => {
    const frozen = Object.freeze(async () => ({ sources: [] }));

    // The return TYPE says marked. Handing back an unmarked function would compile and
    // then lose every font at the first `useDocxSource` call.
    expect(() => defineFontResolver(frozen)).toThrow(TypeError);
    expect(isFontResolver(frozen)).toBe(false);
  });

  test('the mark does not survive .bind() or a wrapper, which the docs say', () => {
    const marked = defineFontResolver(async () => ({ sources: [] }));

    expect(isFontResolver(marked.bind(null))).toBe(false);
    expect(isFontResolver((request: FontResolutionRequest) => marked(request))).toBe(false);
    // Re-marking the new object is the documented fix.
    expect(isFontResolver(defineFontResolver(marked.bind(null)))).toBe(true);
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

  const faceNames = (request: FontResolutionRequest | undefined) =>
    [...(request?.resolvedFaces ?? [])]
      .map((face) => `${face.family}/${face.weight}/${face.style}`)
      .sort();

  test('reports the faces an earlier origin can paint, by BOTH names', async () => {
    const seen: FontResolutionRequest[] = [];
    const first = defineFontResolver(async () => ({
      // What a substitute package answers: bytes under the face it loaded, plus the map
      // from the name the document wrote.
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
    expect(faceNames(seen[0])).toEqual(['Calibri/400/normal', 'Carlito/400/normal']);
    // Everything else about the request is untouched.
    expect(seen[0]!.families).toBe(REQUEST.families);
    expect(seen[0]!.defaultFamily).toBe(REQUEST.defaultFamily);
  });

  test('reports FACES, not families: two faces of one family are two entries', async () => {
    const seen: FontResolutionRequest[] = [];
    // The brand fragment the `useFonts(brandFragment, packagedFonts())` shape produces:
    // some Arial, not all of it. Keyed on family, the two collapsed into one entry saying
    // "Arial", and a packaged origin reading that supplied no italics at all.
    // Three of Arial's four faces, chosen so that dropping ANY limb of the key collapses
    // them: family alone gives one entry, family+weight gives two (400 and 700),
    // family+style gives two (normal and italic). Only all three give three.
    const brand = {
      sources: [
        { ...source('Arial', 'brand-regular') },
        {
          ...source('Arial', 'brand-bold'),
          request: { family: 'Arial', weight: 700, style: 'normal' as const },
        },
        {
          ...source('Arial', 'brand-italic'),
          request: { family: 'Arial', weight: 400, style: 'italic' as const },
        },
      ],
    };
    const second = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [] };
    });

    await composeFontOrigins([brand, second], REQUEST);

    // Bold-italic is the face the brand does NOT hold, and its absence is what lets the
    // origin behind it supply one.
    expect(faceNames(seen[0])).toEqual([
      'Arial/400/italic',
      'Arial/400/normal',
      'Arial/700/normal',
    ]);
  });

  test('reports only faces with BYTES, so a failed origin cannot suppress its failover', async () => {
    const seen: FontResolutionRequest[] = [];
    // Exactly what `packagedFonts()` answers when every asset fetch fails: the whole
    // substitution map, and no sources at all. Both shipped resolvers build the map before
    // fetching, so trusting substitutions alone lost the failover the list exists for.
    const failed = defineFontResolver(async () => ({
      sources: [],
      substitutions: [400, 700].map((weight) => ({
        from: { family: 'Calibri', weight, style: 'normal' as const },
        to: { family: 'Carlito', weight, style: 'normal' as const },
      })),
    }));
    const failover = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [source('Carlito', 'failover')] };
    });

    const merged = await composeFontOrigins([failed, failover], REQUEST);

    // ASKED, and asked about everything. `faceNames(undefined)` is also `[]`, so asserting
    // the list alone would have passed just as well had the failover never been called —
    // which is the outcome this test exists to rule out.
    expect(seen).toHaveLength(1);
    expect(faceNames(seen[0])).toEqual([]);
    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['failover']);
  });

  test('a substitution becomes reportable once a LATER origin supplies its target', async () => {
    const seen: FontResolutionRequest[] = [];
    const mapOnly = defineFontResolver(async () => ({
      substitutions: [
        {
          from: { family: 'Calibri', weight: 400, style: 'normal' as const },
          to: { family: 'Carlito', weight: 400, style: 'normal' as const },
        },
      ],
    }));
    const bytes = defineFontResolver(async () => ({ sources: [source('Carlito', 'bytes')] }));
    const third = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return undefined;
    });

    await composeFontOrigins([mapOnly, bytes, third], REQUEST);

    // Calibri was unpaintable when origin 2 was asked and paintable by the time origin 3
    // was, which is why coverage is recomputed per origin rather than accumulated.
    expect(faceNames(seen[0])).toEqual(['Calibri/400/normal', 'Carlito/400/normal']);
  });

  test('the FIRST origin is asked the request as it came, with nothing marked resolved', async () => {
    const seen: FontResolutionRequest[] = [];
    const record = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return undefined;
    });

    await composeFontOrigins([record], REQUEST);

    expect(seen).toEqual([REQUEST]);
    expect(seen[0]!.resolvedFaces).toBeUndefined();
  });

  test('an origin that answered nothing does not narrow the next one', async () => {
    const seen: FontResolutionRequest[] = [];
    const empty = defineFontResolver(async () => undefined);
    const record = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [] };
    });

    await composeFontOrigins([empty, record], REQUEST);

    expect(seen[0]!.resolvedFaces).toBeUndefined();
  });

  test('passes through the coverage IT was told about', async () => {
    const seen: FontResolutionRequest[] = [];
    const record = defineFontResolver(async (request: FontResolutionRequest) => {
      seen.push(request);
      return { sources: [source('Cambria', 'inner')] };
    });

    // The shape a `useFonts` result used as an origin of another list produces: an inner
    // composition handed a request that already carries coverage. Replacing rather than
    // merging made every inner origin from the second on under-report, and refetch.
    await composeFontOrigins([{ sources: [source('Calibri', 'first')] }, record], {
      ...REQUEST,
      resolvedFaces: [{ family: 'Georgia', weight: 400, style: 'normal' }],
    });

    expect(faceNames(seen[0])).toEqual(['Calibri/400/normal', 'Georgia/400/normal']);
  });

  test('an origin answering null is skipped, not fatal to the ones around it', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    let merged: Awaited<ReturnType<typeof composeFontOrigins>>;
    try {
      // `null`, not `undefined`. "Returning nothing is a valid answer" reads as `null` to
      // plenty of hosts, and `null.sources` took every other origin down with it.
      const nullish = defineFontResolver(async () => null as never);
      merged = await composeFontOrigins(
        [
          { sources: [source('Calibri', 'before')] },
          nullish,
          { sources: [source('Cambria', 'after')] },
        ],
        REQUEST
      );
    } finally {
      console.warn = warn;
    }

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['before', 'after']);
    // A valid "I cover none of this", not a failure: nothing to report.
    expect(warnings).toHaveLength(0);
  });

  test('an origin answering something malformed is skipped WHOLE', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    let merged: Awaited<ReturnType<typeof composeFontOrigins>>;
    try {
      // A source with no `request`: keying it throws. Committing the answer before reading
      // it would leave this fragment in the composition with its faces unrecorded, and
      // break `composeFontConfiguration` later, outside anyone's catch.
      const malformed = defineFontResolver(async () => ({ sources: [{} as never] }));
      merged = await composeFontOrigins(
        [
          { sources: [source('Calibri', 'before')] },
          malformed,
          { sources: [source('Cambria', 'after')] },
        ],
        REQUEST
      );
    } finally {
      console.warn = warn;
    }

    expect(merged?.sources?.map((entry) => entry.id)).toEqual(['before', 'after']);
    expect(warnings).toHaveLength(1);
  });

  test('one throwing origin is reported and skipped; the others still compose', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      const boom = defineFontResolver(() => {
        throw new Error('resolver called as a loader');
      });
      const merged = await composeFontOrigins(
        [
          { sources: [source('Calibri', 'before')] },
          boom,
          { sources: [source('Cambria', 'after')] },
        ],
        REQUEST
      );

      expect(merged?.sources?.map((entry) => entry.id)).toEqual(['before', 'after']);
    } finally {
      console.warn = warn;
    }
    // Reported, not swallowed: this is the failure mode an empty catch made undebuggable.
    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain('font origin failed');
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
