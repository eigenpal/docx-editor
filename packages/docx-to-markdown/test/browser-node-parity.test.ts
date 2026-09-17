import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import {
  createDocxEditor,
  type DocxEditorInstance,
  type EditorModule,
} from '@docx-editor.dev/core/editor';
import type { SemanticLayout } from '@docx-editor.dev/core/layout';
import { loadDefaultFonts } from '@docx-editor.dev/fonts';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalLayout } from './canonical-layout.ts';
import { docx } from './fixture.ts';
import { buildLiteralNodeWorker, type LiteralNodeWorker } from './literal-node-worker.ts';

let nodeWorker: LiteralNodeWorker;
let registeredDomHere = false;

// Markup projection is a review capability in the interactive host. This minimal module keeps
// the parity test in core/private-package territory while enabling the same explicit projection
// the headless worker requests; review-card derivation itself is outside this test's scope.
const parityReviewModule: EditorModule = {
  id: 'review',
  review: {
    displayModes: ['all-markup', 'proposed', 'original'],
    collectReviewItems: () => [],
    revisionItemsOfParagraph: () => [],
  },
};

beforeAll(async () => {
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register();
    registeredDomHere = true;
  }
  nodeWorker = await buildLiteralNodeWorker(
    new URL('./literal-node-worker-entry.ts', import.meta.url)
  );
});

afterAll(() => {
  nodeWorker?.dispose();
  if (registeredDomHere && GlobalRegistrator.isRegistered) GlobalRegistrator.unregister();
});

function childEnvironment(
  additions: Readonly<Record<string, string>>,
  parent: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  // NODE_OPTIONS can carry a heap limit from the parent command. Inheriting it would make the
  // ordinary child silently cease to measure default Node GC policy; explicit argv owns every
  // runtime option used by these isolated workers.
  const { NODE_OPTIONS: _ignored, ...environment } = parent;
  return { ...environment, ...additions };
}

const localFontFetch = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
  const file = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
  try {
    return new Response(
      await readFile(new URL(`../../fonts/assets/${encodeURIComponent(file)}`, import.meta.url)),
      { status: 200 }
    );
  } catch {
    return new Response(null, { status: 404 });
  }
}) as typeof fetch;

async function fontsSettled(editor: DocxEditorInstance): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const state = editor.fontMeasurement();
    if (!state.resolving) {
      expect(state.measurer).toBe('shaped');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('browser font shaping did not settle');
}

function hasPendingResource(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value as object)) return false;
  seen.add(value as object);
  if ((value as { kind?: string }).kind === 'pending') return true;
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'part' && hasPendingResource(child, seen)) return true;
  }
  return false;
}

async function browserLayout(bytes: Uint8Array): Promise<{
  readonly layout: SemanticLayout;
  readonly dispose: () => void;
}> {
  const fonts = await loadDefaultFonts({ fetcher: localFontFetch });
  expect(fonts.failures).toHaveLength(0);
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: bytes,
    fonts,
    modules: [parityReviewModule],
  });
  await fontsSettled(editor);
  let layout = editor.surface?.publishedLayout();
  for (let attempt = 0; layout && hasPendingResource(layout) && attempt < 200; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    layout = editor.surface?.publishedLayout();
  }
  if (!layout) throw new Error('browser surface did not publish layout');
  expect(hasPendingResource(layout)).toBe(false);
  return {
    layout,
    dispose: () => {
      editor.destroy();
      container.remove();
    },
  };
}

describe('browser/server semantic layout parity', () => {
  test.each([
    [
      'narrow shaped text',
      docx(
        '<w:p><w:r><w:t>The quick brown fox jumps over the lazy dog repeatedly across this narrow page.</w:t></w:r></w:p>' +
          '<w:sectPr><w:pgSz w:w="2880" w:h="2880"/><w:pgMar w:top="360" w:right="360" w:bottom="360" w:left="360"/></w:sectPr>'
      ),
    ],
    [
      'tracked insertion and deletion',
      docx(
        '<w:p><w:r><w:t>Kept </w:t></w:r>' +
          '<w:del w:id="1" w:author="Ada" w:date="2026-08-31T00:00:00Z"><w:r><w:delText>removed</w:delText></w:r></w:del>' +
          '<w:ins w:id="2" w:author="Ada" w:date="2026-08-31T00:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins></w:p>'
      ),
    ],
    [
      'shared comprehensive fixture',
      new URL('../../../e2e/fixtures/comprehensive-word-element-test.docx', import.meta.url),
    ],
  ])(
    '%s',
    async (_name, source) => {
      const bytes =
        source instanceof URL ? new Uint8Array(await readFile(source)) : (source as Uint8Array);
      const browser = await browserLayout(bytes);
      // The browser uses its all-markup default; the worker pins that mode explicitly so a future
      // default change cannot silently make the two hosts compare different projections.
      const fixturePath = join(nodeWorker.temporary, 'parity-fixture.docx');
      writeFileSync(fixturePath, bytes);
      const server = spawnSync('node', [nodeWorker.path], {
        cwd: nodeWorker.repositoryRoot,
        env: childEnvironment({
          DOCX_EDITOR_WORKER_MODE: 'parity',
          DOCX_EDITOR_WORKER_FIXTURE: fixturePath,
        }),
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 64 * 1024 * 1024,
      });
      try {
        expect(server.status, server.stderr).toBe(0);
        expect(JSON.parse(server.stdout)).toEqual(canonicalLayout(browser.layout));
      } finally {
        browser.dispose();
      }
    },
    120_000
  );
});

function performanceMeasurement(
  nodeArguments: readonly string[] = [],
  mode: 'performance' | 'one-shot-performance' = 'performance'
): {
  readonly pages: number;
  readonly paragraphs?: number;
  readonly sourceBytes: number;
  readonly markdownLength: number;
  readonly hasDom: boolean;
  readonly peakRssBytes: number;
  readonly liveHeapBytes: number;
  readonly externalBytes: number;
} {
  // `--expose-gc` only adds `globalThis.gc`; it leaves the collection policy alone, so it changes
  // neither the peak this run reaches nor what the constrained arguments below constrain.
  const result = spawnSync('node', ['--expose-gc', ...nodeArguments, nodeWorker.path], {
    cwd: nodeWorker.repositoryRoot,
    env: childEnvironment({
      DOCX_EDITOR_WORKER_MODE: mode,
      DOCX_EDITOR_WORKER_FIXTURE: fileURLToPath(
        new URL('../../../e2e/fixtures/typing-perf-521pp.docx', import.meta.url)
      ),
    }),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  const diagnostics = [
    `mode=${mode} flags=${nodeArguments.join(' ')} status=${result.status} signal=${result.signal}`,
    result.error?.message,
    result.stderr,
  ]
    .filter(Boolean)
    .join('\n');
  expect(result.status, diagnostics).toBe(0);
  process.stdout.write(`Export memory (${mode}): ${result.stdout.trim()}\n`);
  return JSON.parse(result.stdout);
}

test('literal Node workers ignore inherited NODE_OPTIONS', () => {
  expect(
    childEnvironment(
      { DOCX_EDITOR_WORKER_MODE: 'parity' },
      { NODE_OPTIONS: '--max-old-space-size=8' }
    )
  ).toEqual({ DOCX_EDITOR_WORKER_MODE: 'parity' });
});

function expectProductionFixture(
  measurement: ReturnType<typeof performanceMeasurement>,
  options: { readonly inspectLayout?: boolean } = {}
): void {
  expect(measurement.pages).toBeGreaterThanOrEqual(500);
  if (options.inspectLayout ?? true) expect(measurement.paragraphs).toBeGreaterThan(12_000);
  expect(measurement.sourceBytes).toBeGreaterThan(400_000);
  // Keep this a production-sized output guard without depending on redundant inline delimiters.
  expect(measurement.markdownLength).toBeGreaterThan(350_000);
  expect(measurement.hasDom).toBe(false);
}

// Reference runs on macOS arm64 and Linux arm64/x64, using Node 20, 22, 24 and 25, retained
// about 200 MiB for one-shot export and 340 MiB with the layout held by the caller. These budgets
// allow runtime variation while catching the earlier 1.8+ GiB class of retention regression.
const ONE_SHOT_LIVE_HEAP_CEILING = 256 * 1024 * 1024;
const RETAINED_LAYOUT_LIVE_HEAP_CEILING = 448 * 1024 * 1024;

// External memory is the steadiest reading of the three: the same sweep puts every retained-layout
// run within 0.1 MiB of 33 MiB on Node 20 and 39 MiB on Node 24, on all three platforms. It is
// also the only place a HarfBuzz or image-buffer regression can show, since `heapUsed` does not
// count it. One ceiling covers both shapes.
const EXTERNAL_MEMORY_CEILING = 64 * 1024 * 1024;

// Resident set size keeps a backstop rather than a budget, because it is the only reading that
// sees growth outside V8 at all. It cannot be tight: across the same sweep one set of constrained
// arguments spans 532 MiB to 676 MiB on allocator and committed-page overhead alone, and the
// default-heap run reaches 1034 MiB on Linux x64, which is why the 1 GiB ceiling this replaces
// was never survivable. Only a runaway clears it.
const RESIDENT_BACKSTOP = 1536 * 1024 * 1024;

test('a real 500-page shaped export holds a bounded live set on a default heap', () => {
  const measurement = performanceMeasurement();
  expectProductionFixture(measurement);
  // Default V8 grows old space freely and keeps reclaimed pages committed, so an ordinary
  // invocation is where retention shows up first: nothing here forces a collection the way the
  // constrained runs below do. The live set and external memory are the assertions that mean
  // something; resident size only has to stay off the backstop.
  expect(measurement.liveHeapBytes).toBeLessThan(RETAINED_LAYOUT_LIVE_HEAP_CEILING);
  expect(measurement.externalBytes).toBeLessThan(EXTERNAL_MEMORY_CEILING);
  expect(measurement.peakRssBytes).toBeLessThan(RESIDENT_BACKSTOP);
}, 120_000);

// Keep the one-shot export's 364 MiB cap: it releases the layout before measurement. A caller
// retaining the layout needs more execution headroom. In CI, the shared session retained about
// 340 MiB and intermittently aborted during forced GC under the same 364 MiB cap. Its 512 MiB
// old-space cap leaves room above the existing 448 MiB live-heap budget, which we assert below.
// The caps bound transient growth; the live-heap assertions catch retained-memory regressions.
const ONE_SHOT_NODE_ARGUMENTS = ['--max-old-space-size=364', '--max-semi-space-size=8'] as const;
const RETAINED_LAYOUT_NODE_ARGUMENTS = [
  '--max-old-space-size=512',
  '--max-semi-space-size=8',
] as const;

test('the one-shot 500-page export fits a constrained 364 MiB heap', () => {
  const measurement = performanceMeasurement(ONE_SHOT_NODE_ARGUMENTS, 'one-shot-performance');
  expectProductionFixture(measurement, { inspectLayout: false });
  // The one-shot entry point returns markdown and drops the layout, so it settles well below the
  // retained-layout ceiling. That gap is the point: it proves the export does not pin the layout.
  expect(measurement.liveHeapBytes).toBeLessThan(ONE_SHOT_LIVE_HEAP_CEILING);
  expect(measurement.externalBytes).toBeLessThan(EXTERNAL_MEMORY_CEILING);
}, 120_000);

test('the shared core session stays within its live-heap budget under a 512 MiB cap', () => {
  const measurement = performanceMeasurement(RETAINED_LAYOUT_NODE_ARGUMENTS);
  expectProductionFixture(measurement);
  // Apply the same retention budget as the default-heap run, independently of V8's allocation
  // headroom. Keep external memory and RSS guards because neither is bounded by old space.
  expect(measurement.liveHeapBytes).toBeLessThan(RETAINED_LAYOUT_LIVE_HEAP_CEILING);
  expect(measurement.externalBytes).toBeLessThan(EXTERNAL_MEMORY_CEILING);
  expect(measurement.peakRssBytes).toBeLessThan(RESIDENT_BACKSTOP);
}, 120_000);
