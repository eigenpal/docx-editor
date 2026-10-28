// Collaboration scenario fuzzer: run seeded scenarios, shrink a failure, replay it.
//
//   bun scenarios.ts run [--config concurrent] [--delivery server] [--seeds 12] [--from 1]
//   bun scenarios.ts matrix [--seeds 6] [--from 1] [--jobs N]
//   bun scenarios.ts shrink --seed 7 [--config concurrent] [--delivery server] [--match text]
//   bun scenarios.ts shrink --start <actions.json> [--match text]
//   bun scenarios.ts replay <actions.json> [--replicas 4] [--delivery server]
//
// See README.md, "Find collaboration defects", for what each oracle checks.

// First: the scenario clock has to replace Date.now before Yjs loads.
import './scenario-clock.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { defaultMatrixWidth, matrixJobs, runMatrix } from './scenario-matrix.ts';
import {
  replayActions,
  runScenario,
  shrinkActions,
  type Action,
  type Delivery,
  type ScenarioOptions,
} from './scenario-harness.ts';
import { readCase, replayOf, writeCase, type SavedCase } from './scenario-case.ts';
import { REORDER_WEIGHTS, TRACKED_STRUCTURE_WEIGHTS, TRACKED_WEIGHTS } from './scenario-plan.ts';
import { zipDocument } from '../../packages/pro/src/collaboration/__tests__/document-peer-support.ts';

const TEXTBOX_DOCUMENT = path.resolve(
  import.meta.dirname,
  '../../e2e/fixtures/issue-472-floating-textbox.docx'
);

const fixture = (name: string): string =>
  path.resolve(import.meta.dirname, '../../e2e/fixtures', name);

/** Everything at once on a small document, so that edits keep landing on the same nodes. */
const DENSE = { replicas: 3, steps: 120, offlineChance: 0.05, undoChance: 0.1, lateJoiners: 1 };

/** Three plain paragraphs, so splits, joins and breaks keep landing on the same text. */
const PARAGRAPHS_BODY = [
  'First paragraph with repeated words and shared edits.',
  'Second paragraph with text to split and join.',
  'Third paragraph for concurrent deletion and formatting.',
]
  .map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`)
  .join('');

/**
 * Paragraphs that hold another author's pending insertion, deletion, and replacement, beside
 * plain text, so suggesting-mode edits and decisions keep meeting the same changes.
 */
const REVISION = 'w:author="Counterparty" w:date="2025-12-01T00:00:00Z"';
const TRACKED_BODY = [
  `<w:p><w:r><w:t xml:space="preserve">Payment is due within </w:t></w:r><w:ins w:id="1" ${REVISION}><w:r><w:t>thirty (30) days of receipt</w:t></w:r></w:ins><w:r><w:t>.</w:t></w:r></w:p>`,
  `<w:p><w:r><w:t xml:space="preserve">Notice goes to </w:t></w:r><w:del w:id="2" ${REVISION}><w:r><w:delText>the registered office of </w:delText></w:r></w:del><w:r><w:t>each party.</w:t></w:r></w:p>`,
  `<w:p><w:r><w:t xml:space="preserve">The term is </w:t></w:r><w:del w:id="3" ${REVISION}><w:r><w:delText xml:space="preserve">two years </w:delText></w:r></w:del><w:ins w:id="4" ${REVISION}><w:r><w:t>one year</w:t></w:r></w:ins><w:r><w:t xml:space="preserve"> from signing.</w:t></w:r></w:p>`,
  '<w:p><w:r><w:t>Plain text without changes, for edits beside them.</w:t></w:r></w:p>',
].join('');

/**
 * Pending changes whose decisions reach more than one record: formatting on text and on its
 * paragraph mark into the next paragraph, formatting inside another author's insertion, a
 * deleted paragraph with another author's alignment, a named move, a deleted row that holds
 * another author's insertion, a vertical cell merge, and tracked numbering under another
 * author's paragraph change.
 */
const STAMP = (id: number, author: string) =>
  `w:id="${id}" w:author="${author}" w:date="2025-12-0${1 + (id % 8)}T00:00:00Z"`;
const RUN = (text: string, props = '') =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const BOLD_CHANGE = (id: number) =>
  `<w:b/><w:rPrChange ${STAMP(id, 'Counterparty')}><w:rPr/></w:rPrChange>`;
const CELL = (content: string, props = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${props}</w:tcPr>${content}</w:tc>`;
const PLAIN = (text: string) => `<w:p>${RUN(text)}</w:p>`;
const TRACKED_STRUCTURES_BODY = [
  `<w:p><w:pPr><w:rPr>${BOLD_CHANGE(10)}</w:rPr></w:pPr>${RUN('Bold through the mark ', BOLD_CHANGE(11))}</w:p>`,
  `<w:p>${RUN('and into the next paragraph', BOLD_CHANGE(12))}${RUN(' then plain text.')}</w:p>`,
  `<w:p>${RUN('Keep ')}<w:ins ${STAMP(20, 'Reviewer')}>${RUN('inserted with bold', BOLD_CHANGE(21))}</w:ins>${RUN(' tail.')}</w:p>`,
  `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:del ${STAMP(30, 'Counterparty')}/></w:rPr><w:pPrChange ${STAMP(31, 'Reviewer')}><w:pPr/></w:pPrChange></w:pPr><w:del ${STAMP(32, 'Counterparty')}><w:r><w:delText>Deleted centered paragraph.</w:delText></w:r></w:del></w:p>`,
  `<w:p>${RUN('Alpha ')}<w:moveFromRangeStart w:id="40" w:name="mv1" ${STAMP(40, 'Counterparty').replace('w:id="40" ', '')}/><w:moveFrom ${STAMP(41, 'Counterparty')}>${RUN('moved words ')}</w:moveFrom><w:moveFromRangeEnd w:id="40"/>${RUN('beta.')}</w:p>`,
  `<w:p>${RUN('Gamma ')}<w:moveToRangeStart w:id="42" w:name="mv1" ${STAMP(42, 'Counterparty').replace('w:id="42" ', '')}/><w:moveTo ${STAMP(43, 'Counterparty')}>${RUN('moved words ')}</w:moveTo><w:moveToRangeEnd w:id="42"/>${RUN('delta.')}</w:p>`,
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
    `<w:tr>${CELL(PLAIN('a1'))}${CELL(PLAIN('b1'))}</w:tr>` +
    `<w:tr><w:trPr><w:del ${STAMP(50, 'Counterparty')}/></w:trPr>` +
    CELL(
      `<w:p><w:pPr><w:rPr><w:del ${STAMP(51, 'Counterparty')}/></w:rPr></w:pPr><w:del ${STAMP(52, 'Counterparty')}><w:r><w:delText>gone</w:delText></w:r></w:del></w:p>`
    ) +
    CELL(
      `<w:p><w:pPr><w:rPr><w:del ${STAMP(53, 'Counterparty')}/></w:rPr></w:pPr><w:ins ${STAMP(54, 'Reviewer')}>${RUN('new in deleted row')}</w:ins></w:p>`
    ) +
    '</w:tr>' +
    `<w:tr>${CELL(PLAIN('top'), `<w:cellMerge ${STAMP(60, 'Counterparty')} w:vMerge="rest"/>`)}${CELL(PLAIN('b3'))}</w:tr>` +
    `<w:tr>${CELL(PLAIN('below'), `<w:cellMerge ${STAMP(61, 'Counterparty')} w:vMerge="cont"/>`)}${CELL(PLAIN('b4'))}</w:tr>` +
    '</w:tbl>',
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/><w:ins ${STAMP(70, 'Reviewer')}/></w:numPr><w:jc w:val="right"/><w:pPrChange ${STAMP(71, 'Counterparty')}><w:pPr/></w:pPrChange></w:pPr>${RUN('Numbered and aligned.')}</w:p>`,
  PLAIN('Plain text without changes, for edits beside them.'),
].join('');

/**
 * Paragraphs and tables side by side, a cell and a content control that hold several
 * paragraphs, so reorders move paragraphs past tables, tables past tables, and blocks inside
 * a cell, while others type in, split, join, and delete the blocks that move.
 */
const REORDER_CELL = (content: string) =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${content}</w:tc>`;
const REORDER_TABLE = (name: string, cells: readonly string[]) =>
  '<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  `<w:tr>${cells.map(REORDER_CELL).join('')}</w:tr>` +
  `<w:tr>${REORDER_CELL(PLAIN(`${name} lower left`))}${REORDER_CELL(PLAIN(`${name} lower right`))}</w:tr>` +
  '</w:tbl>';
const REORDER_BODY = [
  PLAIN('Zero paragraph before everything.'),
  PLAIN('One paragraph with words to type in.'),
  REORDER_TABLE('First', [
    PLAIN('Cell head') + PLAIN('Cell middle') + PLAIN('Cell tail'),
    PLAIN('Single cell text'),
  ]),
  PLAIN('Two paragraph between the tables.'),
  PLAIN('Three paragraph to split and join.'),
  REORDER_TABLE('Second', [PLAIN('Other cell'), PLAIN('Last cell')]),
  '<w:sdt><w:sdtPr><w:id w:val="7"/></w:sdtPr><w:sdtContent>' +
    PLAIN('Control first paragraph.') +
    PLAIN('Control second paragraph.') +
    '</w:sdtContent></w:sdt>',
  PLAIN('Four paragraph near the end.'),
  PLAIN('Five paragraph at the end.'),
].join('');

/** Named scenario shapes. Each varies one source of concurrency over the same edit mix. */
export const SCENARIO_CONFIGS = {
  sequential: { replicas: 3, steps: 150, delivery: 'in-order' },
  concurrent: { replicas: 4, steps: 200 },
  offline: { replicas: 4, steps: 200, offlineChance: 0.05 },
  undo: { replicas: 3, steps: 200, undoChance: 0.12 },
  // Explicit undo groups opened and closed at random, with pauses past the capture window.
  undoGroups: { replicas: 3, steps: 200, undoChance: 0.12, groupChance: 0.1 },
  join: { replicas: 2, steps: 200, lateJoiners: 3 },
  everything: { replicas: 4, steps: 300, offlineChance: 0.04, undoChance: 0.08, lateJoiners: 2 },
  // Updates that arrive twice, never, or cut short, repaired by state-vector syncs.
  faults: {
    replicas: 4,
    steps: 250,
    offlineChance: 0.03,
    undoChance: 0.06,
    faultChance: 0.12,
    resyncChance: 0.08,
  },
  // Paragraphs inside text boxes, on a document of floating and inline text boxes.
  textbox: { replicas: 3, steps: 200, undoChance: 0.06, documentPath: TEXTBOX_DOCUMENT },
  // Small documents that each hold one kind of structure, edited densely.
  denseTable: { ...DENSE, documentPath: fixture('table-cell-selection-drag.docx') },
  // Cell merge and split against typing, row and column edits, undo, and late joiners.
  tableCells: {
    ...DENSE,
    steps: 160,
    documentPath: fixture('table-cell-selection-drag.docx'),
    weights: { mergeCells: 6, splitCell: 6, insertColumn: 2, deleteColumn: 2, cellFill: 1 },
  },
  denseImages: { ...DENSE, documentPath: fixture('images-wrap-sides.docx') },
  denseControls: { ...DENSE, documentPath: fixture('block-sdt-showcase.docx') },
  denseLinks: { ...DENSE, documentPath: fixture('hyperlink-demo.docx') },
  denseParagraphs: { ...DENSE, replicas: 4, documentBody: PARAGRAPHS_BODY },
  // Suggesting-mode typing and strikes inside, beside and over pending changes, while others
  // accept and reject them.
  tracked: { replicas: 3, steps: 200, documentBody: TRACKED_BODY, weights: TRACKED_WEIGHTS },
  // The same edits one at a time: after every edit, each replica equals one plain store.
  trackedSequential: {
    replicas: 3,
    steps: 150,
    delivery: 'in-order',
    documentBody: TRACKED_BODY,
    weights: TRACKED_WEIGHTS,
  },
  trackedEverything: {
    ...DENSE,
    replicas: 4,
    steps: 200,
    documentBody: TRACKED_BODY,
    weights: TRACKED_WEIGHTS,
  },
  // Card decisions on changes that resolve together, against typing and other decisions.
  trackedStructures: {
    replicas: 3,
    steps: 200,
    documentBody: TRACKED_STRUCTURES_BODY,
    weights: TRACKED_STRUCTURE_WEIGHTS,
  },
  trackedStructuresSequential: {
    replicas: 3,
    steps: 150,
    delivery: 'in-order',
    documentBody: TRACKED_STRUCTURES_BODY,
    weights: TRACKED_STRUCTURE_WEIGHTS,
  },
  trackedStructuresEverything: {
    ...DENSE,
    replicas: 4,
    steps: 200,
    documentBody: TRACKED_STRUCTURES_BODY,
    weights: TRACKED_STRUCTURE_WEIGHTS,
  },
  // Blocks moved up and down by one to three places, and to either end, one or two at a time,
  // against typing inside them, splits and joins beside them, and deletes of their neighbours.
  reorder: { replicas: 3, steps: 150, documentBody: REORDER_BODY, weights: REORDER_WEIGHTS },
  reorderSequential: {
    replicas: 3,
    steps: 120,
    delivery: 'in-order',
    documentBody: REORDER_BODY,
    weights: REORDER_WEIGHTS,
  },
  reorderUndo: {
    replicas: 3,
    steps: 150,
    undoChance: 0.15,
    documentBody: REORDER_BODY,
    weights: REORDER_WEIGHTS,
  },
  reorderEverything: {
    ...DENSE,
    replicas: 4,
    steps: 150,
    documentBody: REORDER_BODY,
    weights: REORDER_WEIGHTS,
  },
} as const satisfies Record<
  string,
  Partial<ScenarioOptions> & { documentPath?: string; documentBody?: string }
>;

export type ScenarioConfig = keyof typeof SCENARIO_CONFIGS;

export const DEFAULT_DOCUMENT = path.resolve(
  import.meta.dirname,
  '../../examples/vite/public/sample.docx'
);

/** The document a shape runs on: its own, or the one the command line names. */
export function documentFor(config: ScenarioConfig, fallback: Uint8Array): Uint8Array {
  const shape = SCENARIO_CONFIGS[config] as { documentPath?: string; documentBody?: string };
  if (shape.documentBody !== undefined) return zipDocument(shape.documentBody);
  return shape.documentPath ? new Uint8Array(readFileSync(shape.documentPath)) : fallback;
}

/** The shape a command runs: the one it names, else a saved case's, else `concurrent`. */
export function configFor(requested: string | undefined, saved?: SavedCase): ScenarioConfig {
  const config = requested ?? saved?.config ?? 'concurrent';
  if (!(config in SCENARIO_CONFIGS)) {
    throw new Error(`unknown --config ${config}; use ${Object.keys(SCENARIO_CONFIGS).join(', ')}`);
  }
  return config as ScenarioConfig;
}

/** The delivery a shape fixes for itself, such as `sequential`, or undefined. */
export function fixedDelivery(config: ScenarioConfig): Delivery | undefined {
  return (SCENARIO_CONFIGS[config] as { delivery?: Delivery }).delivery;
}

/**
 * The delivery a shape runs with. A shape that fixes its own delivery always runs with it,
 * whatever was asked for; any other runs with the one asked for, or `server`.
 */
export function deliveryFor(config: ScenarioConfig, requested?: Delivery): Delivery {
  return fixedDelivery(config) ?? requested ?? 'server';
}

export function scenarioOptions(
  config: ScenarioConfig,
  seed: number,
  document: Uint8Array,
  delivery: Delivery = 'server'
): ScenarioOptions {
  const shape: Partial<ScenarioOptions> = SCENARIO_CONFIGS[config];
  return {
    replicas: 3,
    steps: 200,
    ...shape,
    delivery: deliveryFor(config, delivery),
    seed,
    document,
  } as ScenarioOptions;
}

/** A problem without its replica and step numbers, so equal failures group together. */
export function problemKey(problem: string): string {
  return problem
    .replace(/replica \d+/g, 'replica N')
    .replace(/ at \d+: .*/s, '')
    .slice(0, 120);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      // No parse default: `replay` and `shrink --start` take the saved case's shape.
      config: { type: 'string' },
      delivery: { type: 'string' },
      seeds: { type: 'string', default: '12' },
      from: { type: 'string', default: '1' },
      seed: { type: 'string' },
      match: { type: 'string', default: '' },
      replicas: { type: 'string' },
      document: { type: 'string', default: DEFAULT_DOCUMENT },
      out: { type: 'string' },
      start: { type: 'string' },
      jobs: { type: 'string' },
      // `matrix` only: a comma-separated list of shapes to run instead of all of them.
      configs: { type: 'string' },
      // Check every replica against a fresh build of its shared state after every action.
      strict: { type: 'boolean', default: false },
    },
  });
  const command = positionals[0] ?? 'run';
  // A saved case runs on the document of the shape it was saved from.
  const savedFile =
    command === 'replay' ? positionals[1] : command === 'shrink' ? values.start : undefined;
  const saved = savedFile ? readCase(savedFile) : undefined;
  const config = configFor(values.config, saved);
  const requested = values.delivery as Delivery | undefined;
  // A saved case keeps its own delivery unless `--delivery` overrides it (`replayOf`).
  const delivery = deliveryFor(config, requested);
  const document = documentFor(config, new Uint8Array(readFileSync(values.document!)));
  const strict = values.strict === true;
  const optionsFor = (seed: number): ScenarioOptions => ({
    ...scenarioOptions(config, seed, document, delivery),
    strict,
  });

  // One seed, as a matrix child process: prints one JSON line.
  if (command === 'one') {
    const report = await runScenario(optionsFor(Number(values.seed ?? 1)));
    console.log(JSON.stringify({ applied: report.applied, problem: report.problems[0] ?? null }));
    // A failed join can leave a timer or socket open; the matrix waits for this process.
    process.exit(0);
  }

  if (command === 'matrix') {
    const shapes = values.configs
      ? values.configs.split(',').map((name) => configFor(name.trim()))
      : Object.keys(SCENARIO_CONFIGS);
    const jobs = matrixJobs(
      shapes,
      // A shape that fixes its own delivery runs once, under that delivery's name.
      (name) => {
        const fixed = fixedDelivery(name as ScenarioConfig);
        return fixed ? [fixed] : ['server', 'peer'];
      },
      Number(values.from),
      // Six seeds per shape unless `--seeds` says otherwise; `run` keeps its own default.
      process.argv.some((arg) => arg === '--seeds' || arg.startsWith('--seeds='))
        ? Number(values.seeds)
        : 6
    );
    const width = values.jobs ? Number(values.jobs) : defaultMatrixWidth();
    const started = performance.now();
    console.log(`${jobs.length} seeds across ${width} processes`);
    const results = await runMatrix(
      fileURLToPath(import.meta.url),
      values.document!,
      jobs,
      width,
      (result) => {
        if (result.problem) {
          console.log(
            `FAIL ${result.config} ${result.delivery} seed ${result.seed}: ${result.problem.slice(0, 160)}`
          );
        }
      },
      strict ? ['--strict'] : []
    );
    const groups = new Map<string, { clean: number; total: number; applied: number }>();
    for (const result of results) {
      const key = `${result.config}, ${result.delivery} delivery`;
      const group = groups.get(key) ?? { clean: 0, total: 0, applied: 0 };
      group.total += 1;
      group.applied += result.applied;
      if (!result.problem) group.clean += 1;
      groups.set(key, group);
    }
    for (const [key, group] of [...groups].sort()) {
      console.log(
        `${key}: ${group.clean} of ${group.total} seeds clean, ${group.applied} edits applied`
      );
    }
    const failed = results.filter((result) => result.problem);
    const seconds = ((performance.now() - started) / 1000).toFixed(0);
    console.log(`${results.length - failed.length} of ${results.length} clean in ${seconds} s`);
    for (const result of failed) {
      console.log(
        `  shrink: bun scenarios.ts shrink --config ${result.config} --delivery ${result.delivery} --seed ${result.seed}${strict ? ' --strict' : ''}`
      );
    }
    process.exitCode = failed.length > 0 ? 1 : 0;
    return;
  }

  if (command === 'run') {
    const groups = new Map<
      string,
      { seeds: number[]; example: string; trail: readonly string[] }
    >();
    let applied = 0;
    const first = Number(values.from);
    const count = Number(values.seeds);
    for (let seed = first; seed < first + count; seed += 1) {
      const report = await runScenario(optionsFor(seed));
      applied += report.applied;
      // The first problem names the cause. Later ones are usually its consequences.
      const problem = report.problems[0];
      if (!problem) continue;
      const key = problemKey(problem);
      const group = groups.get(key) ?? { seeds: [], example: problem, trail: report.trail };
      group.seeds.push(seed);
      groups.set(key, group);
    }
    const failed = [...groups.values()].reduce((sum, group) => sum + group.seeds.length, 0);
    console.log(
      `${config}, ${delivery} delivery: ${count - failed} of ${count} seeds clean, ` +
        `${applied} edits applied`
    );
    for (const [key, group] of [...groups].sort((a, b) => b[1].seeds.length - a[1].seeds.length)) {
      console.log(`\n${group.seeds.length} seeds (${group.seeds.join(', ')}): ${key}`);
      console.log(
        `  shrink: bun scenarios.ts shrink --config ${config} --delivery ${delivery} --seed ${group.seeds[0]}${strict ? ' --strict' : ''}`
      );
    }
    process.exitCode = failed > 0 ? 1 : 0;
    return;
  }

  if (command === 'shrink') {
    // A saved case shrinks further without rerunning its whole seed first.
    const seed = saved?.seed ?? Number(values.seed ?? 1);
    const options = optionsFor(seed);
    const replicas = values.replicas ? Number(values.replicas) : undefined;
    // A fresh shrink replays with the delivery its seed ran with.
    const { replicas: replicaCount, delivery: deliveryMode } = saved
      ? replayOf(saved, { replicas, delivery: requested })
      : { replicas: replicas ?? options.replicas, delivery: options.delivery };
    const replay = (actions: readonly Action[]) =>
      replayActions(document, {
        replicas: replicaCount,
        delivery: deliveryMode,
        actions,
        seed,
        strict,
      });
    const save = (file: string, actions: readonly Action[]): void =>
      writeCase(file, { config, seed, replicas: replicaCount, delivery: deliveryMode, actions });
    let start: Action[];
    let target: string | undefined;
    if (saved) {
      start = [...saved.actions];
      const replayed = await replay(start);
      target = replayed.problems.find((problem) => problem.includes(values.match!));
    } else {
      const report = await runScenario(options);
      target = report.problems.find((problem) => problem.includes(values.match!));
      start =
        report.firstFailure < 0
          ? [...report.actions]
          : report.actions.slice(0, report.firstFailure + 1);
    }
    if (!target) {
      console.log(`seed ${seed} has no problem matching "${values.match}"`);
      return;
    }
    const key = values.match || problemKey(target);
    console.log(`target: ${target.slice(0, 300)}`);
    // A saved case shrinks next to itself, never over itself.
    const out =
      values.out ??
      (values.start
        ? `${values.start.replace(/(\.start)?\.json$/, '')}.shrunk.json`
        : `shrunk-${config}-${deliveryMode}-${seed}.json`);
    // The unshrunk case, saved first: shrinking a long seed takes a while, and the case can be
    // replayed or inspected meanwhile.
    save(out.replace(/\.json$/, '.start.json'), start);
    let replays = 0;
    const minimal = await shrinkActions(
      start,
      async (candidate) => {
        replays += 1;
        const result = await replay(candidate);
        return result.problems.some(
          (problem) => problemKey(problem).includes(key) || problem.includes(key)
        );
      },
      (current) => {
        // Saved as it shrinks: stopping a long shrink keeps the smallest case so far, and
        // `--start` resumes from it.
        save(out.replace(/\.json$/, '.progress.json'), current);
      }
    );
    const final = await replay(minimal);
    save(out, minimal);
    console.log(
      `shrunk ${start.length} actions to ${minimal.length} in ${replays} replays: ${out}`
    );
    for (const line of final.trail) console.log(`  ${line.slice(0, 300)}`);
    console.log('problems:');
    for (const problem of final.problems.slice(0, 6)) console.log(`  ${problem.slice(0, 300)}`);
    return;
  }

  if (command === 'replay') {
    if (!saved) throw new Error('replay needs a shrunk JSON file');
    const result = await replayActions(document, {
      ...replayOf(saved, {
        replicas: values.replicas ? Number(values.replicas) : undefined,
        delivery: requested,
        seed: values.seed ? Number(values.seed) : undefined,
      }),
      strict,
    });
    for (const line of result.trail) console.log(`  ${line.slice(0, 300)}`);
    console.log(result.problems.length ? result.problems : 'no problems');
    process.exitCode = result.problems.length ? 1 : 0;
    return;
  }

  throw new Error(`unknown command ${command}; use run, matrix, shrink, or replay`);
}

if (import.meta.main) await main();
