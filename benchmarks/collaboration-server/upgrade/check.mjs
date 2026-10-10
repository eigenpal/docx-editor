#!/usr/bin/env node
// Collaboration upgrade check: rooms that an earlier published release created must keep
// working with this build, as they are when the format is the same, or through a migration
// when it changed. A room migrated by this build must be refused by the earlier one.
//
// It installs the earlier release from the registry, so it needs network access. Run it by
// hand before a release that changes the collaboration format:
// `bun run collaboration:upgrade-check`.
//
//   node benchmarks/collaboration-server/upgrade/check.mjs [--from <version>] [--keep]
//
// --from  the earlier release to start from; the latest published release by default
// --keep  keep the working directory and print where it is

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const here = import.meta.dirname;

/** Documents the scenario matrix also edits: lists, images, controls, links, text boxes. */
const FIXTURES = [
  'examples/vite/public/sample.docx',
  'e2e/fixtures/issue-472-floating-textbox.docx',
  'e2e/fixtures/images-wrap-sides.docx',
  'e2e/fixtures/block-sdt-showcase.docx',
  'e2e/fixtures/hyperlink-demo.docx',
];

/**
 * The last release whose rooms a concurrent property conflict left with two `w:pPr` in one
 * paragraph. Rooms from it must carry that damage into the check, or the repair goes untested.
 */
const LAST_RELEASE_WITH_DOUBLED_PROPERTIES = [2, 27, Infinity];

function releaseAtMost(version, bound) {
  const parts = version.split(/[.-]/).slice(0, 3).map(Number);
  for (let at = 0; at < 3; at += 1) {
    if (parts[at] !== bound[at]) return parts[at] < bound[at];
  }
  return true;
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout ?? '';
}

const from =
  option('--from') ?? run('npm', ['view', '@docx-editor.dev/pro', 'version'], root, true).trim();
const work = mkdtempSync(path.join(tmpdir(), 'collaboration-upgrade-'));
console.log(`Upgrade check from @docx-editor.dev/pro@${from} in ${work}`);
try {
  writeFileSync(path.join(work, 'package.json'), '{"private":true,"type":"module"}\n');
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `@docx-editor.dev/core@${from}`,
      `@docx-editor.dev/pro@${from}`,
      'yjs@^13.6.32',
      'y-protocols@^1.0.7',
    ],
    work
  );
  cpSync(path.join(here, 'earlier.mjs'), path.join(work, 'earlier.mjs'));
  const fixtures = path.join(work, 'fixtures');
  const rooms = path.join(work, 'rooms');
  mkdirSync(fixtures);
  mkdirSync(rooms);
  for (const fixture of FIXTURES) {
    cpSync(path.join(root, fixture), path.join(fixtures, path.basename(fixture)));
  }

  console.log(`\nThe earlier build creates and exports ${FIXTURES.length} rooms`);
  run('node', ['earlier.mjs', 'create', 'fixtures', 'rooms'], work);

  console.log('\nThe current build opens or migrates each room');
  const expectDoubled = releaseAtMost(from, LAST_RELEASE_WITH_DOUBLED_PROPERTIES);
  run(
    'bun',
    [
      path.join(here, 'current.ts'),
      rooms,
      String(FIXTURES.length),
      ...(expectDoubled ? ['--expect-doubled-properties'] : []),
    ],
    root
  );

  if (readdirSync(rooms).some((file) => file.endsWith('.migrated'))) {
    console.log('\nThe earlier build opens each migrated room');
    const lines = run('node', ['earlier.mjs', 'open', 'rooms'], work, true)
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    for (const line of lines) console.log(JSON.stringify(line));
    const served = lines.filter((line) => !line.refused);
    if (served.length > 0) {
      throw new Error(`the earlier build opened ${served.length} migrated rooms`);
    }
  }
  console.log('\nUpgrade check passed');
} finally {
  if (process.argv.includes('--keep') && existsSync(work)) console.log(`Kept ${work}`);
  else rmSync(work, { recursive: true, force: true });
}
