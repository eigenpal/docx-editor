import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { json, option, writeJSON, versions, formatOf } from './common.mjs';
import { catalog, verifyCatalog } from './catalog.mjs';
import {
  CACHE,
  packCandidate,
  releaseInstallation,
  verifyCandidate,
  install,
} from './installation.mjs';
import { Peer } from './peer.mjs';
import { mixedScenario, savedRoomScenario, basicSplitScenario } from './scenarios.mjs';

const trace = [],
  results = [];
rmSync(resolve(CACHE, 'failure.json'), { force: true });
let candidate;
try {
  const all = process.argv.includes('--all');
  const release = option('release');
  assert.ok(!(all && release), 'Select --all or --release, not both');
  if (!all && !release) throw new Error('Select --all or --release <version>');
  const value = all
    ? await verifyCatalog({ allowCurrent: process.argv.includes('--allow-current') })
    : catalog();
  const entries = release
    ? value.releases.filter((entry) => entry.version === release)
    : value.releases;
  assert.ok(entries.length, 'Requested release is not in the catalog');
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
  const shard = option('shard', '1/1').split('/').map(Number);
  assert.ok(
    shard.length === 2 && shard.every(Number.isInteger) && shard[0] > 0 && shard[0] <= shard[1]
  );
  const seedOption = option('seed');
  const seeds = seedOption ? [Number(seedOption)] : [592, 2180];
  assert.ok(seeds.every(Number.isSafeInteger), 'Seed must be an integer');
  if (shard[0] === 1) {
    const fixture = json(`${value.releases.at(-1).directory}/fixture.json`);
    for (const seed of seeds) await mixedScenario(candidate, candidate, fixture, seed, true, trace);
  }
  for (const [index, entry] of entries.entries()) {
    if (index % shard[1] !== shard[0] - 1) continue;
    trace.length = 0;
    console.log(`Checking ${entry.version} (${entry.format}) against ${info.format}`);
    const directory = releaseInstallation(entry);
    try {
      const fixture = json(`${entry.directory}/fixture.json`);
      await savedRoomScenario(directory, candidate, fixture, trace);
      if (entry.format === info.format) {
        await basicSplitScenario(directory, candidate, fixture, trace);
        for (const seed of seeds)
          for (const candidateCreates of [false, true]) {
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
  mkdirSync(CACHE, { recursive: true });
  writeJSON(resolve(CACHE, 'failure.json'), { error: error.stack, candidate, results, trace });
  console.error(error.stack);
  console.error(
    'Trace: .cache/collaboration/failure.json. Reproduce with --release <version> --seed <seed>.'
  );
  process.exitCode = 1;
}
