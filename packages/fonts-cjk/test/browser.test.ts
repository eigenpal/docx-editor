import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { cjkFonts, type CjkFontsRequest } from '../src/browser.ts';
import { NOTO_SANS_CJK_JP_SHA256 } from '../src/families.ts';

const sources = JSON.parse(
  readFileSync(new URL('../assets/sources.json', import.meta.url), 'utf8')
) as Record<string, { installedSha256?: string }>;

const BYTES = new Uint8Array([1, 2, 3]);

/** Most tests check the download itself, so they answer with the face at once. */
const WAIT = { loading: 'wait' } as const;

/** A fetcher that answers with `BYTES` and records each URL it was asked for. */
function recordingFetcher() {
  const urls: string[] = [];
  const fetcher = (async (input: string) => {
    urls.push(input);
    return new Response(BYTES);
  }) as unknown as typeof fetch;
  return { fetcher, urls };
}

const request = (families: string[], extra: Partial<CjkFontsRequest> = {}): CjkFontsRequest => ({
  families,
  defaultFamily: 'Calibri',
  ...extra,
});

test('the stated hash is the packaged face hash', () => {
  expect(NOTO_SANS_CJK_JP_SHA256).toBe(sources['NotoSansCJKjp-Regular.otf']!.installedSha256!);
});

test('the resolver carries the mark the editor reads', () => {
  const resolver = cjkFonts();
  expect((resolver as unknown as Record<string, unknown>)['docx-editor.dev/font-resolver']).toBe(
    true
  );
  expect(
    (resolver as unknown as Record<symbol, unknown>)[Symbol.for('docx-editor.dev/font-resolver')]
  ).toBe(true);
});

test('a document without an East Asian family fetches nothing', async () => {
  const { fetcher, urls } = recordingFetcher();
  const fragment = await cjkFonts({ ...WAIT, fetcher })(request(['Calibri', 'Times New Roman']));
  expect(fragment).toEqual({ sources: [], substitutions: [] });
  expect(urls).toEqual([]);
});

test('English and localized East Asian names point every face at the packaged face', async () => {
  const { fetcher, urls } = recordingFetcher();
  const fragment = await cjkFonts({ ...WAIT, fetcher })(request(['ms mincho', '宋体', 'Calibri']));
  expect(urls).toHaveLength(1);
  expect(urls[0]).toEndWith('/assets/NotoSansCJKjp-Regular.otf');
  expect(fragment.sources).toHaveLength(1);
  expect(fragment.sources[0]).toMatchObject({
    request: { family: 'Noto Sans CJK JP', weight: 400, style: 'normal' },
    hash: `sha256:${NOTO_SANS_CJK_JP_SHA256}`,
    faceIndex: 0,
  });
  expect(fragment.substitutions).toHaveLength(8);
  expect(new Set(fragment.substitutions.map((entry) => entry.from.family))).toEqual(
    new Set(['ms mincho', '宋体'])
  );
  for (const entry of fragment.substitutions) {
    expect(entry.to).toEqual({ family: 'Noto Sans CJK JP', weight: 400, style: 'normal' });
  }
});

test('a family an earlier origin already paints is left to that origin', async () => {
  const { fetcher, urls } = recordingFetcher();
  const fragment = await cjkFonts({ ...WAIT, fetcher })(
    request(['SimSun'], { resolvedFaces: [{ family: 'simsun', weight: 400, style: 'normal' }] })
  );
  expect(fragment).toEqual({ sources: [], substitutions: [] });
  expect(urls).toEqual([]);
});

test('a name that is an object property is no family at all', async () => {
  const { fetcher, urls } = recordingFetcher();
  const fragment = await cjkFonts({ ...WAIT, fetcher })(request(['constructor', '__proto__']));
  expect(fragment).toEqual({ sources: [], substitutions: [] });
  expect(urls).toEqual([]);
});

test('a failed fetch is reported, the document opens without the face, and the next one retries', async () => {
  const failures: string[] = [];
  let calls = 0;
  const fetcher = (async () => {
    calls += 1;
    return calls === 1 ? new Response(null, { status: 404 }) : new Response(BYTES);
  }) as unknown as typeof fetch;
  const resolver = cjkFonts({
    ...WAIT,
    fetcher,
    onFailure: (failure) => failures.push(failure.diagnostic),
  });
  expect(await resolver(request(['SimSun']))).toEqual({ sources: [], substitutions: [] });
  expect(failures).toEqual(['HTTP 404']);
  expect((await resolver(request(['SimSun']))).sources).toHaveLength(1);
});

/** A fetcher whose response waits until `release` is called, recording the request signal. */
function stalledFetcher() {
  const signals: AbortSignal[] = [];
  let release: () => void = () => {};
  const fetcher = ((_input: string, init?: RequestInit) => {
    if (init?.signal) signals.push(init.signal);
    return new Promise<Response>((resolve, reject) => {
      release = () => resolve(new Response(BYTES));
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
  }) as unknown as typeof fetch;
  return { fetcher, signals, release: () => release() };
}

test('cancellation rejects at once and stops a download no other request waits for', async () => {
  const { fetcher, signals } = stalledFetcher();
  const controller = new AbortController();
  const failures: unknown[] = [];
  const pending = cjkFonts({ ...WAIT, fetcher, onFailure: (failure) => failures.push(failure) })(
    request(['SimSun'], { signal: controller.signal })
  );
  controller.abort(new Error('closed'));
  await expect(pending).rejects.toThrow('closed');
  expect(signals[0]?.aborted).toBe(true);
  expect(failures).toEqual([]);
});

test('an already cancelled request downloads nothing', async () => {
  const { fetcher, urls } = recordingFetcher();
  const controller = new AbortController();
  controller.abort(new Error('closed'));
  await expect(
    cjkFonts({ ...WAIT, fetcher })(request(['SimSun'], { signal: controller.signal }))
  ).rejects.toThrow('closed');
  expect(urls).toEqual([]);
});

test('one cancelled request leaves the shared download to the others', async () => {
  const { fetcher, signals, release } = stalledFetcher();
  const resolver = cjkFonts({ ...WAIT, fetcher });
  const controller = new AbortController();
  const cancelled = resolver(request(['SimSun'], { signal: controller.signal }));
  const kept = resolver(request(['MS Mincho']));
  controller.abort(new Error('closed'));
  await expect(cancelled).rejects.toThrow('closed');
  expect(signals).toHaveLength(1);
  expect(signals[0]!.aborted).toBe(false);
  release();
  expect((await kept).sources).toHaveLength(1);
});

test('resolvers without an injected fetcher share one download', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(BYTES);
  }) as unknown as typeof fetch;
  try {
    const [first, second] = await Promise.all([
      cjkFonts(WAIT)(request(['SimSun'])),
      cjkFonts(WAIT)(request(['MS Gothic'])),
    ]);
    expect(first.sources[0]!.bytes).toBe(second.sources[0]!.bytes);
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

test('by default the face loads in the background and arrives on deferred', async () => {
  const { fetcher, urls } = recordingFetcher();
  const fragment = await cjkFonts({ fetcher })(request(['SimSun']));
  expect(fragment.sources).toEqual([]);
  expect(fragment.substitutions).toEqual([]);
  const late = await fragment.deferred;
  expect(late?.sources).toHaveLength(1);
  expect(late?.substitutions).toHaveLength(4);
  expect(urls).toHaveLength(1);
});

test('a background load that is cancelled settles with nothing', async () => {
  const { fetcher } = stalledFetcher();
  const controller = new AbortController();
  const fragment = await cjkFonts({ fetcher })(request(['SimSun'], { signal: controller.signal }));
  controller.abort(new Error('closed'));
  expect(await fragment.deferred).toEqual({ sources: [], substitutions: [] });
});

test('a document without an East Asian family defers nothing', async () => {
  const fragment = await cjkFonts({ fetcher: recordingFetcher().fetcher })(request(['Calibri']));
  expect(fragment.deferred).toBeUndefined();
});
