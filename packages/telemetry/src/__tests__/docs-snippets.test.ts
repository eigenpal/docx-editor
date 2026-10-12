/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Every TypeScript code block in the telemetry docs, the diagnostics guide, and this package's
// README must type-check against the source, so a renamed option or export breaks this test
// instead of a reader's build. Each block is its own module. The prelude declares only what
// the docs leave to the reader: their consent manager, logger, web framework, and handlers.
import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PACKAGE = path.resolve(import.meta.dir, '../..');
const ROOT = path.resolve(PACKAGE, '../..');
const SOURCES = [
  'docs/site/content/telemetry/index.mdx',
  'docs/site/content/telemetry/editors.mdx',
  'docs/site/content/telemetry/servers.mdx',
  'docs/site/content/telemetry/metrics.mdx',
  'docs/site/content/guides/diagnostics.mdx',
  'packages/telemetry/README.md',
];

const PRELUDE = `
type Hook = (payload: any) => Promise<any>;
declare global {
  const consentManager: { readonly analytics: boolean };
  const datadogRum: {
    addError(error: Error, context?: object): void;
    addAction(name: string, context?: object): void;
  };
  const Sentry: typeof import('@sentry/core') & {
    init(options: { dsn: string; integrations?: unknown[]; beforeBreadcrumb?: unknown }): void;
    replayIntegration(options: { block?: string[] }): unknown;
  };
  type Handler = (
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse & { json(body: unknown): void },
    next?: () => void
  ) => unknown;
  const app: { get(path: string, ...handlers: Handler[]): void };
  const requireAdmin: Handler;
  const fastify: {
    get(
      path: string,
      handler: (
        request: { raw: import('node:http').IncomingMessage },
        reply: { raw: import('node:http').ServerResponse; hijack(): void }
      ) => unknown
    ): void;
  };
  const bytes: Uint8Array;
  const onAuthenticate: Hook;
  const onLoadDocument: Hook;
  const beforeHandleMessage: Hook;
  const onStoreDocument: Hook;
  const Server: typeof import('@hocuspocus/server').Server;
  const config: ReturnType<
    typeof import('@docx-editor.dev/telemetry/hocuspocus').withCollaborationTelemetry
  >['config'];
  const rooms: import('@docx-editor.dev/telemetry/server').RoomTelemetry;
  const metrics: import('@docx-editor.dev/telemetry/prometheus').PrometheusRegistry;
  const metricsHandler: typeof import('@docx-editor.dev/telemetry/prometheus').metricsHandler;
  const ydoc: import('yjs').Doc;
  const roomName: string;
  const awareness: import('@docx-editor.dev/telemetry/server').AwarenessLike;
  const error: unknown;
  function loadRoom(doc: import('yjs').Doc): Promise<void>;
}
export {};
`;

// Typed by their public shape: compiling the React adapter here would pull in its own aliases.
const MODULES = `
declare module '@sentry/react' {
  export * from '@sentry/core';
}
declare module '@/lib/metrics' {
  export const metrics: import('@docx-editor.dev/telemetry/prometheus').PrometheusRegistry;
}
declare module '@docx-editor.dev/react' {
  export function DocxEditor(props: {
    document: Uint8Array;
    modules?: readonly import('@docx-editor.dev/core').EditorModule[];
  }): import('react').ReactElement;
}
declare module '@docx-editor.dev/pro' {
  export function reviewModule(): import('@docx-editor.dev/core').EditorModule;
}
`;

function blocks(): { file: string; lang: string; code: string }[] {
  const found: { file: string; lang: string; code: string }[] = [];
  for (const source of SOURCES) {
    const text = readFileSync(path.join(ROOT, source), 'utf8');
    for (const match of text.matchAll(/```(tsx?)\n([\s\S]*?)```/g))
      found.push({ file: source, lang: match[1]!, code: match[2]! });
  }
  return found;
}

test('every TypeScript example in the telemetry docs type-checks', () => {
  const examples = blocks();
  expect(examples.length).toBeGreaterThan(10);
  // Inside node_modules, so package imports resolve as they do for the package itself.
  const dir = path.join(PACKAGE, 'node_modules/.cache/docs-snippets');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'prelude.ts'), PRELUDE);
  writeFileSync(path.join(dir, 'modules.d.ts'), MODULES);
  const origin: string[] = [];
  const named = new Set<string>();
  examples.forEach((example, index) => {
    // A block that opens with its file name, such as `// telemetry.ts`, is saved under it, so
    // the next block can import it.
    const declared = /^\/\/ ([\w-]+\.tsx?)\n/.exec(example.code)?.[1];
    const name = declared && !named.has(declared) ? declared : `example-${index}.${example.lang}`;
    named.add(name);
    origin.push(`${name}: ${example.file}`);
    writeFileSync(path.join(dir, name), example.code);
  });
  const telemetryPaths = JSON.parse(
    readFileSync(path.join(PACKAGE, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  ).compilerOptions.paths as Record<string, string[]>;
  const paths: Record<string, string[]> = {};
  for (const [name, targets] of Object.entries(telemetryPaths))
    paths[name] = targets.map((target) => path.resolve(PACKAGE, target));
  paths['@docx-editor.dev/telemetry'] = [path.join(PACKAGE, 'src/index.ts')];
  paths['@docx-editor.dev/telemetry/*'] = [path.join(PACKAGE, 'src/*/index.ts')];
  paths['@docx-editor.dev/editor-api'] = [path.join(ROOT, 'packages/editor-api/src/index.ts')];
  writeFileSync(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        types: ['bun'],
        module: 'ESNext',
        moduleResolution: 'bundler',
        jsx: 'react-jsx',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        isolatedModules: true,
        paths,
      },
      include: ['*.ts', '*.tsx'],
    })
  );
  const run = Bun.spawnSync(
    ['node', path.join(ROOT, 'node_modules/typescript7/bin/tsc'), '-p', dir],
    { cwd: dir, stdout: 'pipe', stderr: 'pipe' }
  );
  const output = `${run.stdout.toString()}${run.stderr.toString()}`;
  if (run.exitCode !== 0) console.error(`${origin.join('\n')}\n\n${output}`);
  expect(run.exitCode).toBe(0);
  rmSync(dir, { recursive: true, force: true });
}, 120_000);
