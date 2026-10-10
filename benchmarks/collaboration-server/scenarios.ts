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

/** Named scenario shapes. Each varies one source of concurrency over the same edit mix. */
export const SCENARIO_CONFIGS = {
  sequential: { replicas: 3, steps: 150, delivery: 'in-order' },
  concurrent: { replicas: 4, steps: 200 },
  offline: { replicas: 4, steps: 200, offlineChance: 0.05 },
  undo: { replicas: 3, steps: 200, undoChance: 0.12 },
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
  denseImages: { ...DENSE, documentPath: fixture('images-wrap-sides.docx') },
  denseControls: { ...DENSE, documentPath: fixture('block-sdt-showcase.docx') },
  denseLinks: { ...DENSE, documentPath: fixture('hyperlink-demo.docx') },
  denseParagraphs: { ...DENSE, replicas: 4, documentBody: PARAGRAPHS_BODY },
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
    const jobs = matrixJobs(
      Object.keys(SCENARIO_CONFIGS),
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
