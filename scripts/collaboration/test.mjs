import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { json, option, writeJSON, versions, formatOf } from './common.mjs';
import { catalog, verifyCatalog, verifyReleaseFiles } from './catalog.mjs';
import {
  CACHE,
  packCandidate,
  releaseInstallation,
  verifyCandidate,
  install,
} from './installation.mjs';
import { Peer } from './peer.mjs';
import { mixedScenario, savedRoomScenario, basicSplitScenario } from './scenarios.mjs';

import { TEST_HELP, testOptions } from './arguments.mjs';

const trace = [],
  results = [];
let candidate;
let context;
let replay;
try {
  const args = testOptions(process.argv.slice(2));
  if (args.help) {
    console.log(TEST_HELP);
    process.exit(0);
  }
  const all = args.all,
    release = args.release;
  const shard = (args.shard ?? '1/1').split('/').map(Number);
  const seeds = args.seed !== undefined ? [Number(args.seed)] : [592, 2180];
  context = { phase: 'catalog', release: release ?? null, seed: null, shard: shard.join('/') };
  replay = `bun run collaboration:test ${all ? '--all' : `--release ${release}`}`;
  if (args['allow-current']) replay += ' --allow-current';
  rmSync(resolve(CACHE, 'failure.json'), { force: true });
  const value = all
    ? await verifyCatalog({ allowCurrent: process.argv.includes('--allow-current') })
    : catalog();
  const entries = release
    ? value.releases.filter((entry) => entry.version === release)
    : value.releases;
  assert.ok(entries.length, 'Requested release is not in the catalog');
  // Targeted runs protect saved fixtures too, including the candidate-only reference.
  if (!all) {
    for (const entry of new Set([...entries, value.releases.at(-1)])) verifyReleaseFiles(entry);
  }
  context.phase = 'candidate';
  candidate = option('candidate') ?? (await packCandidate());
  verifyCandidate(candidate);
  if (option('candidate')) install(candidate);
  const candidatePeer = new Peer(candidate, 'candidate-info');
  let info;
  try {
    info = await candidatePeer.request('info');
  } finally {
    await candidatePeer.close();
  }
  assert.equal(info.format, formatOf(versions()), 'Packed format differs from source');
  if (shard[0] === 1) {
    const fixture = json(`${value.releases.at(-1).directory}/fixture.json`);
    for (const seed of seeds) {
      context = { phase: 'candidate-only', release: null, seed, shard: shard.join('/') };
      trace.length = 0;
      await mixedScenario(candidate, candidate, fixture, seed, true, trace);
    }
  }
  for (const [index, entry] of entries.entries()) {
    if (index % shard[1] !== shard[0] - 1) continue;
    context = {
      phase: 'release-install',
      release: entry.version,
      seed: null,
      shard: shard.join('/'),
    };
    trace.length = 0;
    console.log(`Checking ${entry.version} (${entry.format}) against ${info.format}`);
    const directory = releaseInstallation(entry);
    try {
      const fixture = json(`${entry.directory}/fixture.json`);
      context.phase = 'saved-room';
      await savedRoomScenario(directory, candidate, fixture, trace);
      if (entry.format === info.format) {
        context.phase = 'basic-split';
        trace.length = 0;
        await basicSplitScenario(directory, candidate, fixture, trace);
        for (const seed of seeds)
          for (const candidateCreates of [false, true]) {
            context = {
              phase: 'mixed',
              release: entry.version,
              seed,
              candidateCreates,
              shard: shard.join('/'),
            };
            trace.length = 0;
            console.log(
              `  seed=${seed}, creator=${candidateCreates ? 'candidate' : entry.version}`
            );
            await mixedScenario(directory, candidate, fixture, seed, candidateCreates, trace);
          }
      }
      results.push({
        version: entry.version,
        status: 'passed',
        mixed: entry.format === info.format,
        migration: true,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  mkdirSync(CACHE, { recursive: true });
  writeJSON(resolve(CACHE, `report-${shard.join('-')}.json`), {
    candidate,
    format: info.format,
    results,
  });
  console.log(`Compatibility passed for ${results.length} releases. Candidate: ${candidate}`);
  if (option('candidate-output')) writeJSON(option('candidate-output'), { candidate });
} catch (error) {
  console.error(error.stack);
  if (context) {
    const reproduce = context.release
      ? `bun run collaboration:test --release ${context.release}${context.seed === null ? '' : ` --seed ${context.seed}`}`
      : `${replay}${context.seed === null ? '' : ` --seed ${context.seed}`}`;
    mkdirSync(CACHE, { recursive: true });
    writeJSON(resolve(CACHE, 'failure.json'), {
      error: error.stack,
      candidate,
      context,
      reproduce,
      results,
      trace,
    });
    console.error(`Trace: .cache/collaboration/failure.json\nReproduce: ${reproduce}`);
    if (option('candidate'))
      console.error(
        'To reuse the failed package build, add --candidate with the recorded candidate directory.'
      );
  }
  process.exitCode = 1;
}
