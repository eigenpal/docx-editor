// Memory and time of a room migration, by document size, under Node.js.
//
//   node benchmarks/collaboration-server/migration/memory.mjs [--sizes 500,2000] [--fixtures]
//
// Each measurement runs `measure.mjs` in a process of its own, one at a time, so no run
// shares a heap with another. For each document it reports:
//
// - time: how long `migrateCollaborationRoom` took;
// - peak RSS: the most memory the whole process held, including Node.js and the modules;
// - minimum heap: the smallest `--max-old-space-size` with which the migration completes,
//   found by bisection. This is the figure to size a migration worker by.
//
// Build the packages first: the benchmark imports the built `@docx-editor.dev/pro`.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const here = import.meta.dirname;
const root = path.resolve(here, '../../..');
const { values } = parseArgs({
  strict: true,
  options: {
    sizes: { type: 'string', default: '500,1000,2000,5000,10000,20000' },
    fixtures: { type: 'boolean', default: false },
  },
});

const FIXTURES = [
  'e2e/fixtures/demo.docx',
  'e2e/fixtures/issue-68-large-comments-suggestions.docx',
  'e2e/fixtures/typing-perf-521pp.docx',
];

/** One run of `measure.mjs`, or null when it did not complete under `heapMiB`. */
function measure(input, heapMiB) {
  const args = [
    '--expose-gc',
    ...(heapMiB ? [`--max-old-space-size=${heapMiB}`] : []),
    path.join(here, 'measure.mjs'),
    ...input,
  ];
  const run = spawnSync(process.execPath, args, { cwd: here, encoding: 'utf8' });
  if (run.status !== 0) return null;
  return JSON.parse(run.stdout.trim().split('\n').at(-1));
}

/** The smallest heap limit, in MiB, under which the migration completes, within 8%. */
function minimumHeapMiB(input, ceiling) {
  let low = 16;
  let high = ceiling;
  while (high / low > 1.08) {
    const middle = Math.round(Math.sqrt(low * high));
    if (measure(input, middle)) high = middle;
    else low = middle;
  }
  return high;
}

const mib = (bytes) => Math.round(bytes / 1024 / 1024);
const inputs = [
  ...values.sizes.split(',').map((size) => ({
    name: `${Number(size).toLocaleString('en-US')} paragraphs (synthetic)`,
    input: ['--paragraphs', size],
  })),
  ...(values.fixtures
    ? FIXTURES.map((fixture) => ({
        name: path.basename(fixture),
        input: ['--fixture', path.join(root, fixture)],
      }))
    : []),
];

const rows = [];
for (const { name, input } of inputs) {
  const free = measure(input, null);
  if (!free) throw new Error(`${name}: the migration did not complete`);
  const ceiling = Math.max(64, mib(free.peakRssBytes) * 2);
  const row = {
    name,
    paragraphs: free.paragraphs,
    docxKiB: Math.round(free.docxBytes / 1024),
    stateKiB: Math.round(free.stateBytes / 1024),
    seconds: Number(free.seconds.toFixed(2)),
    peakRssMiB: mib(free.peakRssBytes),
    baselineRssMiB: mib(free.baselineRssBytes),
    minimumHeapMiB: minimumHeapMiB(input, ceiling),
  };
  rows.push(row);
  console.log(JSON.stringify(row));
}

const table = [
  '| Document | Paragraphs | DOCX | Room state | Time | Peak RSS | Minimum heap |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(
    (row) =>
      `| ${row.name} | ${row.paragraphs.toLocaleString('en-US')} | ${row.docxKiB} KiB | ` +
      `${row.stateKiB} KiB | ${row.seconds} s | ${row.peakRssMiB} MiB | ${row.minimumHeapMiB} MiB |`
  ),
].join('\n');
console.log(`\nNode.js ${process.version}, ${process.platform} ${process.arch}\n\n${table}`);
const results = path.join(here, 'results');
mkdirSync(results, { recursive: true });
writeFileSync(
  path.join(results, 'memory.json'),
  `${JSON.stringify({ node: process.version, platform: `${process.platform} ${process.arch}`, rows }, null, 2)}\n`
);
