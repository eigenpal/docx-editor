/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Every TypeScript code block in the telemetry docs, the diagnostics guide, and this package's
// README must type-check against the source, so a renamed option or export breaks this test
// instead of a reader's build. Each block is its own module. A block may use a name only if it
// imports or declares it, an earlier block on the same page does, or the reader supplies it
// (their consent manager, logger, web framework, and handlers).
import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PACKAGE = path.resolve(import.meta.dir, '../..');
const ROOT = path.resolve(PACKAGE, '../..');
const TELEMETRY_DOCS = path.join(ROOT, 'docs/site/content/telemetry');
const SOURCES = [
  ...readdirSync(TELEMETRY_DOCS)
    .filter((name) => name.endsWith('.mdx'))
    .sort()
    .map((name) => path.join(TELEMETRY_DOCS, name)),
  path.join(ROOT, 'docs/site/content/guides/diagnostics.mdx'),
  path.join(PACKAGE, 'README.md'),
];

/** Pages outside the telemetry docs: only their blocks that show a refusal's diagnostic. */
const PARTIAL_SOURCES: readonly { readonly file: string; readonly contains: string }[] = [
  {
    file: path.join(ROOT, 'docs/site/content/editor-api/batching-and-errors.mdx'),
    contains: 'debugInfo.innerError',
  },
  {
    file: path.join(ROOT, 'packages/editor-api/OFFICE_JS_GUIDE.md'),
    contains: 'debugInfo.innerError',
  },
];

/** What the reader supplies. Never a package export: those must be imported. */
const READER: Readonly<Record<string, string>> = {
  context: '{ sync(): Promise<void> }',
  feedback: 'string[]',
  consentManager: '{ readonly analytics: boolean }',
  datadogRum:
    '{ addError(error: Error, context?: object): void; addAction(name: string, context?: object): void }',
  app: '{ get(path: string, ...handlers: Handler[]): void }',
  requireAdmin: 'Handler',
  fastify: `{ get(path: string, handler: (request: { raw: import('node:http').IncomingMessage }, reply: { raw: import('node:http').ServerResponse; hijack(): void }) => unknown): void }`,
  bytes: 'Uint8Array',
  onAuthenticate: 'Hook',
  onLoadDocument: 'Hook',
  beforeHandleMessage: 'Hook',
  onStoreDocument: 'Hook',
  ydoc: `import('yjs').Doc`,
  roomName: 'string',
  awareness: `import('@docx-editor.dev/telemetry/server').AwarenessLike`,
  error: 'unknown',
  loadRoom: `(doc: import('yjs').Doc) => Promise<void>`,
};

/** Names an earlier block on the same page may set up, as one file would. */
const CARRIED: Readonly<Record<string, string>> = {
  Server: `typeof import('@hocuspocus/server').Server`,
  config: `ReturnType<typeof import('@docx-editor.dev/telemetry/hocuspocus').withCollaborationTelemetry>['config']`,
  rooms: `import('@docx-editor.dev/telemetry/server').RoomTelemetry`,
  metrics: `import('@docx-editor.dev/telemetry/prometheus').PrometheusRegistry`,
  metricsHandler: `typeof import('@docx-editor.dev/telemetry/prometheus').metricsHandler`,
  telemetry: `import('@docx-editor.dev/telemetry').Telemetry`,
};

const SHARED_TYPES = `type Hook = (payload: any) => Promise<any>;
type Handler = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse & { json(body: unknown): void }, next?: () => void) => unknown;
`;

// Typed by their public shape: compiling the React adapter here would pull in its own aliases.
const MODULES = `
declare module '@sentry/react' {
  export * from '@sentry/core';
  export function init(options: import('@sentry/core').Options): void;
  export function replayIntegration(options: { block?: string[] }): import('@sentry/core').Integration;
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

interface Example {
  readonly file: string;
  readonly lang: 'ts' | 'tsx';
  readonly code: string;
  /** Code of the earlier blocks on the same page. */
  readonly before: string;
}

/** A block that opens with its own file name, such as `// telemetry.ts` or `// lib/sentry.client.ts`. */
const FILE_HEADER = /^\/\/ ([\w./-]+\.tsx?)\n/;

const FENCE = /^[ \t]*```(ts|tsx|typescript)\b[^\n]*\r?\n([\s\S]*?)^[ \t]*```/gm;

function examples(): Example[] {
  const found: Example[] = [];
  const pages = [...SOURCES.map((file) => ({ file, contains: '' })), ...PARTIAL_SOURCES];
  for (const { file, contains } of pages) {
    const text = readFileSync(file, 'utf8');
    let before = '';
    for (const match of text.matchAll(FENCE)) {
      const code = match[2]!.replace(/\r\n/g, '\n');
      if (code.includes(contains))
        found.push({ file, lang: match[1] === 'tsx' ? 'tsx' : 'ts', code, before });
      // A block that names its file, such as `// telemetry.ts`, is a separate file: what it
      // defines is imported, never carried.
      if (!FILE_HEADER.test(code)) before += `\n${code}`;
    }
  }
  return found;
}

/** Whether the code imports or declares a name at the top level. */
function defines(code: string, name: string): boolean {
  const word = `\\b${name}\\b`;
  return (
    new RegExp(`^\\s*import\\b[^;]*${word}[^;]*from`, 'm').test(code) ||
    new RegExp(
      `^\\s*(?:export\\s+)?(?:const|let|function|class)\\s+(?:\\{[^}]*${word}|${name}\\b)`,
      'm'
    ).test(code)
  );
}

function uses(code: string, name: string): boolean {
  // A spread (`...config`) uses the name; a property access (`event.config`) does not.
  return new RegExp(`(?<![.\\w'"/])${name}\\b`).test(code.replace(/\.\.\./g, '   '));
}

/** The declarations a block needs: what the reader supplies, and what earlier blocks set up. */
function context(example: Example): string {
  const lines: string[] = [];
  for (const [name, type] of Object.entries(READER))
    if (uses(example.code, name) && !defines(example.code, name))
      lines.push(`declare const ${name}: ${type};`);
  for (const [name, type] of Object.entries(CARRIED))
    if (uses(example.code, name) && !defines(example.code, name) && defines(example.before, name))
      lines.push(`declare const ${name}: ${type};`);
  return lines.length ? `${SHARED_TYPES}${lines.join('\n')}\n` : '';
}

test('the docs contain no JavaScript blocks that this check would skip', () => {
  for (const source of SOURCES)
    expect(readFileSync(source, 'utf8').match(/^[ \t]*```(js|jsx|javascript)\b/gm) ?? []).toEqual(
      []
    );
});

test('every TypeScript example in the telemetry docs type-checks', () => {
  const found = examples();
  expect(found.length).toBeGreaterThan(10);
  // A selected page whose example was rewritten would otherwise drop out of the check unseen.
  for (const { file } of PARTIAL_SOURCES)
    expect(
      found.filter((example) => example.file === file).length,
      path.relative(ROOT, file)
    ).toBeGreaterThan(0);
  // Inside node_modules, so package imports resolve as they do for the package itself; one
  // directory per run, so two runs in one checkout never share files.
  const cache = path.join(PACKAGE, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const dir = mkdtempSync(path.join(cache, 'docs-snippets-'));
  try {
    writeFileSync(path.join(dir, 'modules.d.ts'), MODULES);
    const origin: string[] = [];
    const named = new Set<string>();
    found.forEach((example, index) => {
      // A block that opens with its file name, such as `// telemetry.ts`, is saved under it, so
      // a later block can import it.
      // The blocks share one directory, so a nested path keeps its last segment.
      const fileName = FILE_HEADER.exec(example.code)?.[1];
      const declared = fileName ? path.posix.basename(fileName) : undefined;
      const name = declared && !named.has(declared) ? declared : `example-${index}.${example.lang}`;
      named.add(name);
      origin.push(`${name}: ${path.relative(ROOT, example.file)}`);
      const header = context(example);
      // A block with no import or export is a script; `export {}` keeps it a module, so its
      // declarations stay its own.
      writeFileSync(path.join(dir, name), `${header}${example.code}\nexport {};\n`);
    });
    writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig()));
    const run = Bun.spawnSync(
      ['node', path.join(ROOT, 'node_modules/typescript7/bin/tsc'), '-p', dir],
      { cwd: dir, stdout: 'pipe', stderr: 'pipe' }
    );
    const output = `${run.stdout.toString()}${run.stderr.toString()}`;
    if (run.exitCode !== 0) console.error(`${origin.join('\n')}\n\n${output}`);
    expect(run.exitCode).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);

function tsconfig(): object {
  const telemetryPaths = JSON.parse(
    readFileSync(path.join(PACKAGE, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  ).compilerOptions.paths as Record<string, string[]>;
  const paths: Record<string, string[]> = {};
  for (const [name, targets] of Object.entries(telemetryPaths))
    paths[name] = targets.map((target) => path.resolve(PACKAGE, target));
  paths['@docx-editor.dev/telemetry'] = [path.join(PACKAGE, 'src/index.ts')];
  paths['@docx-editor.dev/telemetry/*'] = [path.join(PACKAGE, 'src/*/index.ts')];
  paths['@docx-editor.dev/editor-api'] = [path.join(ROOT, 'packages/editor-api/src/index.ts')];
  return {
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
      moduleDetection: 'force',
      paths,
    },
    include: ['*.ts', '*.tsx'],
  };
}

test('the metrics page lists every metric with its type, labels, and description', async () => {
  const { METRICS, prometheusName } = await import('../metrics.ts');
  const page = readFileSync(path.join(TELEMETRY_DOCS, 'metrics.mdx'), 'utf8');
  const rows = new Map<string, string>();
  for (const match of page.matchAll(/^\| `([a-z_]+)` \| (.+) \|$/gm))
    rows.set(match[1]!, match[2]!);
  const expected = Object.values(METRICS).map((definition) => {
    const labels = definition.labels.length
      ? definition.labels.map((label) => `\`${label}\``).join(', ')
      : 'none';
    return [
      prometheusName(definition),
      `${definition.kind} | ${labels} | ${definition.description}`,
    ];
  });
  // The page sets option names in code font; the catalog text, which exporters send, does not.
  const plain = (row: string | undefined) => row?.replaceAll('`', '');
  expect(expected.filter(([name, row]) => plain(rows.get(name!)) !== plain(row))).toEqual([]);
  expect([...rows.keys()].sort()).toEqual(expected.map(([name]) => name!).sort());
});
