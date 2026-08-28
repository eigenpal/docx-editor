/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
// The Vue twin of `packages/react/test/font-origins.test.tsx`.
//
// Same two paths, same promises: an eager origin holds the document until it settles, an
// on-demand resolver cannot be waited for and so is handed straight through behind one
// stable identity. Vue adds one hazard of its own — `toValue` CALLS a plain function to
// read a getter, and a resolver called with no argument reads `defaultFamily` off
// `undefined` and throws — so `useFonts` is asserted to leave a marked resolver alone.

import './dom-setup.ts';

import { describe, expect, test } from 'bun:test';
import { createApp, ref } from 'vue';
import { defineFontResolver, isFontResolver } from '@docx-editor.dev/core/editor';
import type { FontResolutionRequest } from '@docx-editor.dev/core/editor';
import type { FontSource } from '@docx-editor.dev/core/contracts/editor';
import { useDocxSource } from '../src/editor/useDocxSource';
import { useFonts } from '../src/editor/useFonts';

const BYTES = new Uint8Array([1, 2, 3]);
const REQUEST: FontResolutionRequest = { families: ['Calibri'], defaultFamily: 'Calibri' };

function source(family: string, id: string): FontSource {
  return {
    request: { family, weight: 400, style: 'normal' },
    id,
    bytes: new Uint8Array([0]),
    hash: `sha256:${id}`,
    faceIndex: 0,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

/** Mount a setup function, run `body` against what it returned, then unmount. */
async function mounted<T>(setup: () => T, body: (value: T) => Promise<void> | void): Promise<void> {
  let value!: T;
  const app = createApp({
    setup() {
      value = setup();
      return () => null;
    },
  });
  app.mount(document.createElement('div'));
  try {
    await body(value);
  } finally {
    app.unmount();
  }
}

describe('useDocxSource: the eager path still holds the document', () => {
  test('document stays undefined until a zero-argument loader settles', async () => {
    const gate = deferred<{ sources: FontSource[] }>();

    await mounted(
      () => useDocxSource(BYTES, { fonts: () => gate.promise }),
      async (result) => {
        await flush();
        expect(result.document.value).toBeUndefined();
        expect(result.isLoading.value).toBe(true);

        gate.resolve({ sources: [source('Calibri', 'eager')] });
        await flush();

        expect(result.document.value).toBe(BYTES);
        expect(result.isLoading.value).toBe(false);
      }
    );
  });

  test('a failing loader releases the document instead of holding it forever', async () => {
    await mounted(
      () => useDocxSource(BYTES, { fonts: () => Promise.reject(new Error('no faces today')) }),
      async (result) => {
        await flush();
        expect(result.document.value).toBe(BYTES);
      }
    );
  });

  test('a list of eager origins composes first-wins', async () => {
    await mounted(
      () =>
        useDocxSource(BYTES, {
          fonts: [
            { sources: [source('Calibri', 'first')] },
            { sources: [source('Calibri', 'last')] },
          ],
        }),
      async (result) => {
        await flush();
        const merged = result.fonts.value as unknown as { sources: FontSource[] };
        expect(merged.sources.map((entry) => entry.id)).toEqual(['first']);
      }
    );
  });
});

describe('useDocxSource: the on-demand path cannot wait, and does not pretend to', () => {
  test('document is released at once and `fonts` is a resolver', async () => {
    const resolver = defineFontResolver(async () => ({ sources: [source('Calibri', 'lazy')] }));

    await mounted(
      () => useDocxSource(BYTES, { fonts: resolver }),
      (result) => {
        // No flush: the answer must be right on the very first read.
        expect(result.document.value).toBe(BYTES);
        expect(result.isLoading.value).toBe(false);
        expect(typeof result.fonts.value).toBe('function');
      }
    );
  });

  test('the resolver keeps ONE identity across origin changes', async () => {
    const origins = ref(defineFontResolver(async () => ({ sources: [source('Calibri', 'a')] })));

    await mounted(
      () => useDocxSource(BYTES, () => ({ fonts: origins.value })),
      async (result) => {
        const first = result.fonts.value;
        origins.value = defineFontResolver(async () => ({ sources: [source('Calibri', 'b')] }));
        await flush();

        expect(result.fonts.value).toBe(first);
        const merged = (await (first as (r: FontResolutionRequest) => Promise<unknown>)(
          REQUEST
        )) as { sources: FontSource[] };
        // Same identity, latest origins: the resolver reads the options at resolve time.
        expect(merged.sources.map((entry) => entry.id)).toEqual(['b']);
      }
    );
  });

  test('one resolver in a list is enough to make the whole list on demand', async () => {
    await mounted(
      () =>
        useDocxSource(BYTES, {
          fonts: [
            { sources: [source('Cambria', 'brand')] },
            defineFontResolver(async () => ({ sources: [source('Calibri', 'lazy')] })),
          ],
        }),
      async (result) => {
        expect(result.document.value).toBe(BYTES);
        const merged = (await (
          result.fonts.value as (r: FontResolutionRequest) => Promise<unknown>
        )(REQUEST)) as { sources: FontSource[] };
        expect(merged.sources.map((entry) => entry.id)).toEqual(['brand', 'lazy']);
      }
    );
  });
});

describe('useFonts takes every origin in the same shape', () => {
  test('a marked resolver is the value, never a getter Vue may call', async () => {
    let calls = 0;
    const resolver = defineFontResolver(async (request: FontResolutionRequest) => {
      calls += 1;
      return { sources: [source(request.defaultFamily, 'lazy')] };
    });

    await mounted(
      () => useFonts(resolver),
      async (compose) => {
        const merged = (await compose(REQUEST)) as { sources: FontSource[] };
        // Exactly once, and with the request — `toValue` calling it as a getter would
        // have thrown on `undefined.defaultFamily` before ever reaching here.
        expect(calls).toBe(1);
        expect(merged.sources.map((entry) => entry.id)).toEqual(['lazy']);
      }
    );
  });

  test('two resolvers compose, which is the packaged-plus-Google shape', async () => {
    await mounted(
      () =>
        useFonts(
          defineFontResolver(async () => ({ sources: [source('Calibri', 'packaged')] })),
          defineFontResolver(async () => ({ sources: [source('Montserrat', 'google')] }))
        ),
      async (compose) => {
        const merged = (await compose(REQUEST)) as { sources: FontSource[] };
        expect(merged.sources.map((entry) => entry.id)).toEqual(['packaged', 'google']);
      }
    );
  });

  test('the result is MARKED, so it can be an origin of another list', async () => {
    await mounted(
      () => useFonts(defineFontResolver(async () => ({ sources: [source('Calibri', 'a')] }))),
      async (composed) => {
        expect(isFontResolver(composed)).toBe(true);
        // Unmarked, `useFonts` would read it as a getter and `toValue` would call it with
        // no argument — the exact failure this round fixed.
        await mounted(
          () => useFonts(composed),
          async (outer) => {
            const merged = (await outer(REQUEST)) as { sources: FontSource[] };
            expect(merged.sources.map((entry) => entry.id)).toEqual(['a']);
          }
        );
      }
    );
  });

  test('a LOADER in an on-demand list is still called with no argument', async () => {
    let sawArguments: unknown;

    await mounted(
      () =>
        useDocxSource(BYTES, {
          fonts: [
            (...args: unknown[]) => {
              sawArguments = args;
              return { sources: [source('Cambria', 'loader')] };
            },
            defineFontResolver(async () => ({ sources: [source('Calibri', 'resolver')] })),
          ] as never,
        }),
      async (result) => {
        const merged = (await (
          result.fonts.value as (r: FontResolutionRequest) => Promise<unknown>
        )(REQUEST)) as { sources: FontSource[] };
        expect(sawArguments).toEqual([]);
        expect(merged.sources.map((entry) => entry.id)).toEqual(['loader', 'resolver']);
      }
    );
  });

  test('one rejecting eager origin does not discard the others', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      await mounted(
        () =>
          useDocxSource(BYTES, {
            fonts: [
              { sources: [source('Calibri', 'before')] },
              () => Promise.reject(new Error('boom')),
              { sources: [source('Cambria', 'after')] },
            ],
          }),
        async (result) => {
          await flush();
          const merged = result.fonts.value as unknown as { sources: FontSource[] };
          expect(merged.sources.map((entry) => entry.id)).toEqual(['before', 'after']);
        }
      );
    } finally {
      console.warn = warn;
    }

    expect(warnings).toHaveLength(1);
  });

  test('an unmarked resolver is read as a value, by arity, not called as a getter', async () => {
    // No `defineFontResolver`. A one-argument function cannot be a `MaybeRefOrGetter`
    // getter, so `toValue` must not call it — this is what threw on `main`.
    const unmarked = (request: FontResolutionRequest) => ({
      sources: [source(request.defaultFamily, 'unmarked')],
    });

    await mounted(
      () => useFonts(unmarked),
      async (compose) => {
        const merged = (await compose(REQUEST)) as { sources: FontSource[] };
        expect(merged.sources.map((entry) => entry.id)).toEqual(['unmarked']);
      }
    );
  });

  test('a zero-argument getter is re-read on every resolve, not captured once', async () => {
    let calls = 0;
    const getter = () => {
      calls += 1;
      return { sources: [source('Calibri', `call-${calls}`)] };
    };

    await mounted(
      () => useFonts(getter),
      async (compose) => {
        const first = (await compose(REQUEST)) as { sources: FontSource[] };
        const second = (await compose(REQUEST)) as { sources: FontSource[] };

        // The getter form exists so a host can compute origins from reactive state; a
        // resolver that captured the first read would serve the first document's fonts to
        // every document after it.
        expect(first.sources.map((entry) => entry.id)).toEqual(['call-1']);
        expect(second.sources.map((entry) => entry.id)).toEqual(['call-2']);
      }
    );
  });

  test('a throwing eager loader is reported, not swallowed', async () => {
    const warnings: unknown[][] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      await mounted(
        () => useDocxSource(BYTES, { fonts: () => Promise.reject(new Error('boom')) }),
        async () => {
          await flush();
        }
      );
    } finally {
      console.warn = warn;
    }

    expect(warnings).toHaveLength(1);
    expect(String(warnings[0]?.[0])).toContain('font loading failed');
  });

  test('a ref origin is still read reactively', async () => {
    const fragment = ref<{ sources: FontSource[] } | undefined>({
      sources: [source('Calibri', 'brand')],
    });

    await mounted(
      () => useFonts(fragment),
      async (compose) => {
        expect(await compose(REQUEST)).toBeDefined();
        fragment.value = undefined;
        expect(await compose(REQUEST)).toBeUndefined();
      }
    );
  });
});
