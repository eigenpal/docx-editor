import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
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
  const editor = createDocxEditor({ container, document: bytes, fonts });
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
      'shared comprehensive fixture',
      new URL('../../../e2e/fixtures/comprehensive-word-element-test.docx', import.meta.url),
    ],
  ])(
    '%s',
    async (_name, source) => {
      const bytes =
        source instanceof URL ? new Uint8Array(await readFile(source)) : (source as Uint8Array);
      const browser = await browserLayout(bytes);
      // The interactive editor's final-state projection is `proposed`; the headless API
      // defaults to `original`, so parity explicitly compares the same projection.
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

function performanceMeasurement(nodeArguments: readonly string[] = []): {
  readonly pages: number;
  readonly paragraphs: number;
  readonly sourceBytes: number;
  readonly markdownLength: number;
  readonly hasDom: boolean;
  readonly peakRssBytes: number;
} {
  const result = spawnSync('node', [...nodeArguments, nodeWorker.path], {
    cwd: nodeWorker.repositoryRoot,
    env: childEnvironment({
      DOCX_EDITOR_WORKER_MODE: 'performance',
      DOCX_EDITOR_WORKER_FIXTURE: fileURLToPath(
        new URL('../../../e2e/fixtures/typing-perf-521pp.docx', import.meta.url)
      ),
    }),
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  expect(result.status, result.stderr).toBe(0);
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

function expectProductionFixture(measurement: ReturnType<typeof performanceMeasurement>): void {
  expect(measurement.pages).toBeGreaterThanOrEqual(500);
  expect(measurement.paragraphs).toBeGreaterThan(12_000);
  expect(measurement.sourceBytes).toBeGreaterThan(400_000);
  expect(measurement.markdownLength).toBeGreaterThan(400_000);
  expect(measurement.hasDom).toBe(false);
}

test('a real 500-page shaped export stays below the default Node peak-memory budget', () => {
  const measurement = performanceMeasurement();
  expectProductionFixture(measurement);
  // Default V8 deliberately keeps reclaimed old-space pages committed. This ceiling measures
  // an ordinary invocation and catches the original 1.8+ GiB regression without treating
  // committed-but-reusable heap as the live set.
  expect(measurement.peakRssBytes).toBeLessThan(1024 * 1024 * 1024);
}, 120_000);

test('the same 500-page export fits a constrained sub-768 MiB runtime', () => {
  const measurement = performanceMeasurement(['--max-old-space-size=352']);
  expectProductionFixture(measurement);
  // Constraining old space makes V8 collect rather than retain transient layout allocations,
  // proving the complete shaped export's live working set fits a bounded container.
  expect(measurement.peakRssBytes).toBeLessThan(768 * 1024 * 1024);
}, 120_000);
