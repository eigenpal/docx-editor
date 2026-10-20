// Load benchmark for one Hocuspocus collaboration room.
//
// Each step starts a fresh room server, fills one room with simulated participants, and
// has them type for the configured duration. The test fails when a step is unhealthy: the
// server crashed, a participant could not join, a session failed, an edit never arrived,
// the replicas did not converge, or the saved DOCX does not match them.
//
// Run it from the repository root after `bun run build:packages`:
//
//   bun run bench:collaboration
//
// See README.md in this directory for the settings and for how to read the results.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_EDIT_PROFILE, type EditProfile } from './edit-model.ts';
import { markdown, summarize, writeSummary } from './report.ts';
import { environment, runStep, type StepResult } from './runner.ts';

const env = process.env;
const participants = (env.BENCH_PARTICIPANTS ?? '5,10,15,20,25')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
// Share of each room that types; the rest stay connected and read. One step per pair.
const activeShares = (env.BENCH_ACTIVE_SHARES ?? '1')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => value > 0 && value <= 1);
const durationMs = Number(env.BENCH_DURATION_S ?? 60) * 1000;
const participantsPerWorker = Number(env.BENCH_PER_WORKER ?? 1);
const seed = Number(env.BENCH_SEED ?? 1);
const typingScale = Number(env.BENCH_TYPING_SCALE ?? 1);
const profile: EditProfile = {
  ...DEFAULT_EDIT_PROFILE,
  keystrokeMs: DEFAULT_EDIT_PROFILE.keystrokeMs / typingScale,
  pauseMs: [
    DEFAULT_EDIT_PROFILE.pauseMs[0] / typingScale,
    DEFAULT_EDIT_PROFILE.pauseMs[1] / typingScale,
  ],
  sharedParagraphShare: Number(env.BENCH_SHARED_SHARE ?? DEFAULT_EDIT_PROFILE.sharedParagraphShare),
};
const documentPath = path.resolve(
  env.BENCH_DOCUMENT ?? path.join(import.meta.dirname, '../../examples/vite/public/sample.docx')
);
const maxP95Ms = env.BENCH_MAX_P95_MS ? Number(env.BENCH_MAX_P95_MS) : null;
const startedAt = new Date().toISOString();
const outDir = path.resolve(
  env.BENCH_OUT ??
    path.join(import.meta.dirname, 'results', startedAt.replaceAll(':', '-').replace(/\..+$/, ''))
);
const settings = {
  participants,
  activeShares,
  durationS: durationMs / 1000,
  participantsPerWorker,
  seed,
  typingScale,
  document: path.basename(documentPath),
  server: env.BENCH_URL ?? 'benchmark server, started per step',
  profile,
};

mkdirSync(outDir, { recursive: true });
const results: StepResult[] = [];

describe('collaboration server under load', () => {
  for (const share of activeShares) {
    for (const count of participants) {
      const pct = Number((share * 100).toFixed(1));
      const step = `step-${pct}pct-${count}`;
      test(
        `${count} participants, ${pct}% typing`,
        async () => {
          const result = await runStep({
            participants: count,
            activeShare: share,
            participantsPerWorker,
            durationMs,
            seed,
            profile,
            documentPath,
            workDir: path.join(outDir, step),
            token: env.BENCH_TOKEN ?? 'benchmark-token',
            ...(env.BENCH_URL ? { externalUrl: env.BENCH_URL } : {}),
          });
          results.push(result);
          writeFileSync(
            path.join(outDir, step, 'result.json'),
            `${JSON.stringify(result, null, 2)}\n`
          );
          console.log(
            `${count} participants (${result.activeParticipants} typing): ` +
              `${result.edits.perSecond.toFixed(1)} edits/s, ` +
              `latency p95 ${result.latencyMs.p95.toFixed(1)} ms, ` +
              `server CPU ${result.server.load?.cpuAvgPct.toFixed(1) ?? 'n/a'} %, ` +
              `RSS ${result.server.load?.rssMaxMb.toFixed(0) ?? 'n/a'} MB, ` +
              `healthy ${result.healthy}`
          );
          expect(result.problems).toEqual([]);
          if (maxP95Ms !== null) expect(result.latencyMs.p95).toBeLessThanOrEqual(maxP95Ms);
        },
        durationMs + 300_000
      );
    }
  }
});

afterAll(() => {
  const summary = summarize(startedAt, environment(), settings, results);
  writeSummary(outDir, summary);
  console.log(`\n${markdown(summary)}\nResults: ${outDir}`);
});
