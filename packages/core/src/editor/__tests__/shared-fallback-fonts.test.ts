import { describe, expect, test } from 'bun:test';
import type { FontSource } from '../../contracts/editor.ts';
import type { FontResolutionRequest } from '../../layout/font-composition.ts';
import { FontResolutionError } from '../../layout/font-resource.ts';
import type { LayoutShapingOptions } from '../../layout/shaped-measurer.ts';
import {
  createEditorFallbackFonts,
  createFallbackFaceCaches,
  createGlyphFallbackDemand,
  resolveSharedFallbackFonts,
  withGlyphFallbackFamilies,
} from '../shared-fallback-fonts.ts';

const face = (family: string, weight = 400, style: 'normal' | 'italic' = 'normal') => ({
  family,
  weight,
  style,
});
const source = (family: string, weight = 400, style: 'normal' | 'italic' = 'normal'): FontSource =>
  ({
    request: face(family, weight, style),
    id: `${family}#${weight}#${style}`,
    bytes: new Uint8Array([1]),
    hash: `sha256:${family}-${weight}-${style}`,
    faceIndex: 0,
  }) as FontSource;

/** A host that serves `served` under their own names and records what it is asked for. */
function host(served: readonly string[]) {
  const requests: FontResolutionRequest[] = [];
  return {
    requests,
    resolve(request: FontResolutionRequest) {
      requests.push(request);
      const wanted = request.faces ?? request.families.map((family) => face(family));
      return {
        sources: wanted
          .filter((one) => served.includes(one.family))
          .map((one) => source(one.family, one.weight, one.style)),
      };
    },
  };
}

const request = (
  families: readonly string[],
  faces = families.map((family) => face(family))
): FontResolutionRequest => ({ families, defaultFamily: 'Calibri', faces });

const resolve = (
  input: Partial<Parameters<typeof resolveSharedFallbackFonts>[0]> & {
    readonly request: FontResolutionRequest;
  }
) =>
  resolveSharedFallbackFonts({
    explicit: { sources: [source('Carlito')] },
    embedded: [],
    host: undefined,
    cache: createFallbackFaceCaches().of('load'),
    installed: () => false,
    ...input,
  });

describe('the shared fallback rules over a host', () => {
  test('a host that answers for every family is not asked again', async () => {
    const fonts = host(['Liberation Sans']);
    const shared = await resolve({
      explicit: { sources: [source('Brand Sans')] },
      request: request(['Brand Sans']),
      host: fonts.resolve,
    });
    expect(fonts.requests).toEqual([]);
    expect(shared.standIns.substitutions ?? []).toEqual([]);
    expect([...shared.substituted]).toEqual([]);
  });

  test('a missing family takes the fallback face of its class, read in one request', async () => {
    const fonts = host(['Liberation Serif', 'Liberation Sans']);
    const shared = await resolve({
      request: request(['Sagona', 'Georgia', 'Foo Grotesk']),
      host: fonts.resolve,
    });
    expect(fonts.requests).toHaveLength(1);
    // The fallback faces by name, never the missing families again.
    expect(fonts.requests[0]!.families.toSorted()).toEqual(['Liberation Sans', 'Liberation Serif']);
    const target = (family: string) =>
      [...(shared.named.substitutions ?? []), ...(shared.standIns.substitutions ?? [])].find(
        ({ from }) => from.family === family && from.weight === 400 && from.style === 'normal'
      )?.to.family;
    expect(target('Georgia')).toBe('Liberation Serif');
    expect(target('Sagona')).toBe('Liberation Serif');
    expect(target('Foo Grotesk')).toBe('Liberation Sans');
    expect([...shared.substituted].toSorted()).toEqual(['foo grotesk', 'georgia', 'sagona']);
  });

  test('a metric-compatible substitute is not reported as a substitution', async () => {
    const fonts = host(['Liberation Sans', 'Liberation Serif']);
    const shared = await resolve({
      request: request(['Helvetica', 'Times New Roman Bold', 'Verdana']),
      host: fonts.resolve,
    });
    expect(shared.named.substitutions?.some(({ from }) => from.family === 'Helvetica')).toBe(true);
    expect([...shared.substituted]).toEqual(['verdana']);
  });

  test('the request names the face that the text uses', async () => {
    const fonts = host(['Liberation Serif']);
    await resolve({
      request: request(['Sagona'], [face('Sagona', 700, 'italic')]),
      host: fonts.resolve,
    });
    expect(fonts.requests[0]!.faces).toEqual([face('Liberation Serif', 700, 'italic')]);
  });

  test('a family that the platform has installed keeps its own face', async () => {
    const fonts = host(['Liberation Serif']);
    const shared = await resolve({
      request: request(['Sagona']),
      host: fonts.resolve,
      installed: (family) => family === 'Sagona',
    });
    expect(fonts.requests).toEqual([]);
    expect([...shared.substituted]).toEqual([]);
  });

  test('a family with an embedded face is not replaced', async () => {
    const fonts = host(['Liberation Serif']);
    const shared = await resolve({
      request: request(['Sagona']),
      embedded: [source('Sagona')],
      host: fonts.resolve,
    });
    expect(
      (shared.standIns.substitutions ?? []).filter(({ to }) => to.family !== 'Sagona')
    ).toEqual([]);
    expect([...shared.substituted]).toEqual([]);
  });

  test('a host without the fallback face gives no substitution and is asked once', async () => {
    const fonts = host([]);
    const cache = createFallbackFaceCaches().of('load');
    const first = await resolve({ request: request(['Sagona']), host: fonts.resolve, cache });
    await resolve({ request: request(['Sagona']), host: fonts.resolve, cache });
    expect(fonts.requests).toHaveLength(1);
    expect(first.standIns.substitutions ?? []).toEqual([]);
    expect([...first.substituted]).toEqual([]);
  });

  test('a face read before comes from the cache, and a new face asks again', async () => {
    const fonts = host(['Liberation Serif']);
    const cache = createFallbackFaceCaches().of('load');
    await resolve({ request: request(['Sagona']), host: fonts.resolve, cache });
    const again = await resolve({ request: request(['Sagona']), host: fonts.resolve, cache });
    expect(fonts.requests).toHaveLength(1);
    expect(again.standIns.sources).toHaveLength(1);
    await resolve({
      request: request(['Sagona'], [face('Sagona'), face('Sagona', 700)]),
      host: fonts.resolve,
      cache,
    });
    expect(fonts.requests).toHaveLength(2);
    expect(fonts.requests[1]!.faces).toEqual([face('Liberation Serif', 700)]);
  });

  test('a host that fails for the fallback faces keeps its first answer', async () => {
    let requests = 0;
    const cache = createFallbackFaceCaches().of('load');
    const failing = () => {
      requests += 1;
      return Promise.reject(new Error('network'));
    };
    const shared = await resolve({ request: request(['Sagona']), host: failing, cache });
    expect(shared.standIns.substitutions ?? []).toEqual([]);
    await resolve({ request: request(['Sagona']), host: failing, cache });
    expect(requests).toBe(1);
  });

  test('a cancelled request for the fallback faces rejects', async () => {
    const controller = new AbortController();
    const cancelled = () => {
      controller.abort(new Error('cancelled'));
      return Promise.reject(controller.signal.reason);
    };
    await expect(
      resolve({
        request: { ...request(['Sagona']), signal: controller.signal },
        host: cancelled,
      })
    ).rejects.toThrow('cancelled');
  });

  test('a later request that names fewer families keeps the fallback of the earlier ones', async () => {
    const fonts = host(['Liberation Serif', 'Liberation Sans']);
    const cache = createFallbackFaceCaches().of('load');
    await resolve({ request: request(['Sagona']), host: fonts.resolve, cache });
    const later = await resolve({ request: request(['Foo Grotesk']), host: fonts.resolve, cache });
    expect([...later.substituted].sort()).toEqual(['foo grotesk', 'sagona']);
  });

  test('a new document load reads its faces again', () => {
    const caches = createFallbackFaceCaches();
    const first = caches.of('1/1');
    expect(caches.of('1/1')).toBe(first);
    expect(caches.of('2/1')).not.toBe(first);
  });

  test('a host that holds bytes is searched, not asked', async () => {
    const shared = await resolve({
      request: request(['Sagona']),
      host: { sources: [source('Carlito'), source('Liberation Serif')] },
    });
    expect(shared.standIns.sources?.map((one) => one.request.family)).toEqual(['Liberation Serif']);
    expect([...shared.substituted]).toEqual(['sagona']);
  });

  test('no host answer leaves the fonts as they are', async () => {
    const fonts = host(['Liberation Serif']);
    const shared = await resolve({
      explicit: undefined,
      request: request(['Sagona']),
      host: fonts.resolve,
    });
    expect(fonts.requests).toEqual([]);
    expect(shared.named).toEqual({});
  });
});

describe('the composed configuration', () => {
  test('host faces, named fallback faces, document faces, then stand-ins', async () => {
    const fonts = host(['Liberation Serif', 'Liberation Sans']);
    const shared = await createEditorFallbackFonts(() => {}).resolve({
      epoch: 7,
      key: 'load',
      host: fonts.resolve,
      explicit: { sources: [source('Carlito')] },
      embedded: { fonts: [], maxFontBytes: 1_000_000 },
      request: request(['Georgia', 'Foo Grotesk']),
      installed: undefined,
      compose: (composed) => composed,
    });
    const composed = shared.compose(shared.explicit?.sources ?? [], {
      sources: [source('Embedded')],
    });
    expect(composed.epoch).toBe(7);
    expect(composed.sources.map((one) => one.request.family)).toEqual([
      'Carlito',
      'Liberation Serif',
      'Embedded',
      'Liberation Sans',
    ]);
    expect([...shared.substituted].toSorted()).toEqual(['foo grotesk', 'georgia']);
  });
});

describe('the glyph fallback demand', () => {
  /** Shaping whose every glyph is missing, over fonts that hold `families`. */
  const shapingOver = (families: readonly string[]) => {
    const requests: string[] = [];
    const shaping = {
      fonts: {
        resolve(request: { family: string }) {
          requests.push(request.family);
          return families.includes(request.family)
            ? ({ request, hash: request.family, faceIndex: 0 } as never)
            : new FontResolutionError('missing', request as never);
        },
      },
      shaper: {
        shape: (input: { text: string }) =>
          ({
            glyphs: [...input.text].map((_, cluster) => ({ id: 0, cluster, advanceX: 0 })),
            clusters: [...input.text].map((_, index) => ({
              textStart: index,
              textEnd: index + 1,
              glyphStart: index,
              glyphEnd: index + 1,
            })),
            fontSpans: [],
          }) as never,
      },
    } as unknown as LayoutShapingOptions;
    return { shaping, requests };
  };
  const input = (text: string) =>
    ({
      text,
      fontSizeHalfPoints: 22,
      bidiLevel: 0,
      environment: { script: 'Latn', features: {}, font: { hash: 'primary', faceIndex: 0 } },
    }) as never;

  test('starts empty and forgets its families on reset', () => {
    const demand = createGlyphFallbackDemand(() => {});
    expect(demand.families()).toEqual([]);
    expect(withGlyphFallbackFamilies(['Arial'], demand)).toEqual(['Arial']);
    demand.shaping(shapingOver([]).shaping, true).shaper.shape(input('☐'));
    expect(demand.has('Noto Sans Symbols 2')).toBe(true);
    demand.reset();
    expect(demand.has('Noto Sans Symbols 2')).toBe(false);
    expect(demand.pending()).toBe(false);
  });

  test('an uncovered character asks once for the first step of the chain', () => {
    const asked: boolean[] = [];
    const demand = createGlyphFallbackDemand((held) => asked.push(held));
    const { shaper } = demand.shaping(shapingOver([]).shaping, true);
    shaper.shape(input('☐'));
    shaper.shape(input('☒'));
    expect(asked).toEqual([false]);
    expect(demand.families()).toEqual(['Segoe UI Symbol', 'Noto Sans Symbols 2']);
    expect(withGlyphFallbackFamilies(['Arial', 'segoe ui symbol'], demand)).toEqual([
      'Segoe UI Symbol',
      'Noto Sans Symbols 2',
      'Arial',
    ]);
  });

  test('the next step waits until the faces of the step before are installed', () => {
    const asked: boolean[] = [];
    const demand = createGlyphFallbackDemand((held) => asked.push(held));
    const first = demand.shaping(shapingOver([]).shaping, true);
    first.shaper.shape(input('☐'));
    // Still uncovered in the shaping that was built before the faces arrived: no new step.
    first.shaper.shape(input('☐'));
    expect(asked).toHaveLength(1);
    // A shaping built with those faces asked for, and the character still uncovered.
    demand.shaping(shapingOver([]).shaping, true).shaper.shape(input('☐'));
    expect(asked).toHaveLength(2);
    expect(demand.families()).toContain('Noto Sans Math');
    expect(demand.families()).not.toContain('Noto Sans CJK JP');
  });

  test('the chain holds the families asked for, not a family the fonts hold besides', () => {
    const demand = createGlyphFallbackDemand(() => {});
    // The fonts hold Times New Roman, a fallback face of a later step. Nothing asked for it.
    const before = shapingOver(['Times New Roman']);
    demand.shaping(before.shaping, true).shaper.shape(input('☐'));
    expect(before.requests).not.toContain('Times New Roman');
    const after = shapingOver(['Times New Roman']);
    demand.shaping(after.shaping, true);
    expect(after.requests).toEqual(['Segoe UI Symbol', 'Noto Sans Symbols 2']);
  });

  test('a face that the fonts already hold is pending until the fonts install again', () => {
    const asked: boolean[] = [];
    const demand = createGlyphFallbackDemand((held) => asked.push(held));
    const fonts = shapingOver(['Noto Sans Symbols 2']).shaping;
    demand.shaping(fonts, true).shaper.shape(input('☐'));
    expect(asked).toEqual([true]);
    expect(demand.pending()).toBe(true);
    demand.shaping(fonts, true);
    expect(demand.pending()).toBe(false);
  });

  test('a fixed set of fonts holds the whole chain from the first layout and asks for nothing', () => {
    const asked: boolean[] = [];
    const demand = createGlyphFallbackDemand((held) => asked.push(held));
    const fonts = shapingOver(['Times New Roman']);
    demand.shaping(fonts.shaping, true, true);
    expect(fonts.requests).toContain('Times New Roman');
    // An uncovered character over fonts that hold no fallback face: nothing can load later.
    demand.shaping(shapingOver([]).shaping, true, true).shaper.shape(input('☐'));
    expect(asked).toEqual([]);
    expect(demand.pending()).toBe(false);
    expect(demand.families()).toContain('Noto Emoji');
  });
});
