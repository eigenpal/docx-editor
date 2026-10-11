#!/usr/bin/env node
// Edit-memory profiler: does editing a document keep growing the heap, and what holds it?
//
// Opens a .docx in the demo dev server in Chrome, runs batches of one edit kind, and takes a
// heap snapshot after each batch. Reports the heap after every batch, memlab's leak clusters
// (objects allocated in the second batch and still alive after the third), and which named
// Map/WeakMap/Set caches grew. See scripts/memory/README.md.

import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { config as memlabConfig, getFullHeapFromFile } from 'memlab';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    edits: { type: 'string', default: 'enter' },
    batches: { type: 'string', default: '20,40,60' },
    url: { type: 'string', default: 'http://localhost:5173' },
    out: { type: 'string', default: join(root, 'local', 'memory-profile') },
    'min-retained': { type: 'string', default: '20000' },
    'max-kb-per-edit': { type: 'string' },
    channel: { type: 'string', default: 'chrome' },
    help: { type: 'boolean', default: false },
  },
});

if (values.help || !values.file) {
  console.log(`Usage: bun run memory:edits -- --file <document.docx> [options]

Options:
  --edits <kind>            enter | toggle | type | mixed (default: enter)
  --batches <a,b,c>         edit counts at the three snapshots (default: 20,40,60)
  --url <url>               demo dev server (default: http://localhost:5173)
  --out <dir>               snapshots and reports (default: local/memory-profile)
  --min-retained <bytes>    smallest leak memlab reports (default: 20000)
  --max-kb-per-edit <kb>    exit 1 when the last batch grew the heap by more per edit
  --channel <name>          Playwright browser channel (default: chrome)

Start the demo first with \`bun run dev\`.`);
  process.exit(values.help ? 0 : 1);
}

const file = resolve(values.file);
if (!existsSync(file)) throw new Error(`No such file: ${file}`);
const batches = values.batches.split(',').map(Number);
if (batches.length !== 3 || batches.some((n, i) => !(n > (batches[i - 1] ?? 0)))) {
  throw new Error('--batches takes three increasing edit counts, such as 20,40,60');
}
const kinds = ['enter', 'toggle', 'type', 'mixed'];
if (!kinds.includes(values.edits)) throw new Error(`--edits takes one of ${kinds.join(', ')}`);
mkdirSync(values.out, { recursive: true });

const response = await fetch(values.url).catch(() => null);
if (!response?.ok) throw new Error(`No demo at ${values.url}. Start it with \`bun run dev\`.`);

const browser = await chromium.launch({ channel: values.channel });
const heaps = {};
const snapshots = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/memory-profile.docx', (route) => route.fulfill({ path: file }));
  await page.goto(`${values.url}/?perfE2e=1&fixture=memory-profile.docx`);
  await page.waitForFunction(
    () => {
      const editor = window.__DOCX_EDITOR_E2E__?.getEditor();
      return !!editor?.surface && !editor.snapshot().isOpening;
    },
    null,
    { timeout: 300_000 }
  );
  const cdp = await page.context().newCDPSession(page);
  const heapMb = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = await cdp.send('Runtime.getHeapUsage');
    return Math.round((usedSize / 2 ** 20) * 10) / 10;
  };
  const snapshot = async (path) => {
    const stream = createWriteStream(path);
    const write = (message) => stream.write(message.chunk);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', write);
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
    cdp.off('HeapProfiler.addHeapSnapshotChunk', write);
    await new Promise((done) => stream.end(done));
  };
  // Edits spread over the document: a caret at the start of one of twenty paragraphs, then
  // the edit. Each waits for any background layout, so a batch ends with a settled layout.
  const edit = (from, count) =>
    page.evaluate(
      async ([from, count, kind]) => {
        const surface = window.__DOCX_EDITOR_E2E__.getEditor().surface;
        const settled = async () => {
          await new Promise((done) => setTimeout(done, 20));
          while (document.querySelector('[data-docx-layout-pending]')) {
            await new Promise((done) => setTimeout(done, 20));
          }
        };
        for (let step = from; step < from + count; step += 1) {
          const ids = surface.session.paragraphIds();
          const id = ids[Math.floor((((step % 20) + 1) / 22) * ids.length)];
          surface.setSelection({
            anchor: { paragraphId: id, offset: 0 },
            head: { paragraphId: id, offset: 0 },
          });
          const which = kind === 'mixed' ? ['enter', 'toggle', 'type'][step % 3] : kind;
          if (which === 'enter') surface.splitParagraph();
          else if (which === 'toggle') surface.toggleList('bullet');
          else surface.type('x');
          await settled();
        }
      },
      [from, count, values.edits]
    );

  heaps.open = await heapMb();
  let done = 0;
  for (const [index, total] of batches.entries()) {
    await edit(done, total - done);
    done = total;
    heaps[`after${total}`] = await heapMb();
    const path = join(values.out, `snapshot-${index + 1}.heapsnapshot`);
    await snapshot(path);
    snapshots.push(path);
    console.log(`after ${total} edits: ${heaps[`after${total}`]} MB`);
  }
} finally {
  await browser.close();
}

// memlab: objects allocated between snapshots 1 and 2 that are still alive in snapshot 3.
const filter = join(values.out, 'leak-filter.cjs');
writeFileSync(
  filter,
  `module.exports = { leakFilter: (node) => node.type === 'object' && node.retainedSize >= ${Number(values['min-retained'])} };\n`
);
const memlab = join(root, 'node_modules', '.bin', 'memlab');
const leaks = spawnSync(
  memlab,
  [
    'find-leaks',
    '--baseline',
    snapshots[0],
    '--target',
    snapshots[1],
    '--final',
    snapshots[2],
    '--leak-filter',
    filter,
    '--work-dir',
    join(values.out, 'memlab'),
  ],
  { encoding: 'utf8', maxBuffer: 256 * 2 ** 20 }
);
const leakReport = (leaks.stdout + leaks.stderr).replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
writeFileSync(join(values.out, 'memlab-report.txt'), leakReport);

// Named caches: what every Map, WeakMap, Set and WeakSet held by a closure or module variable
// retains, from snapshot 2 to snapshot 3. A cache that grows with every edit usually keys
// answers by node identity, and the undo history keeps those nodes alive.
async function namedCaches(path) {
  memlabConfig.muteConsole = true;
  const heap = await getFullHeapFromFile(path);
  const counts = new Map();
  heap.nodes.forEach((node) => {
    if (!node.name.startsWith('system / Context')) return;
    for (const edge of node.references) {
      if (edge.type !== 'context') continue;
      const holder = edge.toNode;
      if (!['Map', 'WeakMap', 'Set', 'WeakSet'].includes(holder.name)) continue;
      const key = `${holder.name} ${edge.name_or_index}`;
      const previous = counts.get(key) ?? { retained: 0 };
      counts.set(key, { retained: previous.retained + holder.retainedSize });
    }
  });
  return counts;
}
const before = await namedCaches(snapshots[1]);
const after = await namedCaches(snapshots[2]);
const lastBatch = batches[2] - batches[1];
const grownCaches = [...after]
  .map(([name, now]) => ({
    name,
    kbPerEdit: (now.retained - (before.get(name)?.retained ?? 0)) / 1024 / lastBatch,
    retainedKb: Math.round(now.retained / 1024),
  }))
  .filter((cache) => cache.kbPerEdit > 0.5)
  .sort((a, b) => b.kbPerEdit - a.kbPerEdit)
  .slice(0, 25);

const growth = heaps[`after${batches[2]}`] - heaps[`after${batches[1]}`];
const perEditKb = Math.round((growth * 1024) / lastBatch);
const summary = {
  file,
  edits: values.edits,
  heapsMb: heaps,
  lastBatchGrowthKbPerEdit: perEditKb,
  growingCaches: grownCaches,
};
writeFileSync(join(values.out, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

console.log(`\nLast batch: ${perEditKb} KB per edit.`);
console.log('\nNamed caches that grew in the last batch (KB per edit, KB retained now):');
for (const cache of grownCaches) {
  console.log(
    `  ${cache.kbPerEdit.toFixed(1).padStart(8)}  ${String(cache.retainedKb).padStart(8)}  ${cache.name}`
  );
}
if (grownCaches.length === 0) console.log('  none');
const clusters = leakReport.slice(leakReport.indexOf('MemLab found'));
console.log(`\n${clusters.trim() || 'memlab produced no report; see memlab-report.txt.'}`);
console.log(`\nSnapshots and reports: ${values.out}`);

const limit = values['max-kb-per-edit'];
if (limit !== undefined && perEditKb > Number(limit)) {
  console.error(`\nThe heap grew ${perEditKb} KB per edit, over the ${limit} KB limit.`);
  process.exit(1);
}
