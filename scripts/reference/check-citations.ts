// Check each ECMA-376 subclause citation in the tracked files against the subclause index that
// `bun run reference:fetch` writes. A citation names a part and a subclause, for example
// "ECMA-376 Part 1, 18.3.1.13" or "Part 3, 7.2". The check fails when a cited subclause is not in
// the index of its part, and it prints the title of each cited subclause with `--list`, so a
// reader can see that the title matches the element that the comment names.
//
//   bun run reference:check-citations          fail on a subclause that the index does not have
//   bun run reference:check-citations --list   also print each citation with its title
//
// It needs the local index (git-ignored), so CI does not run it. A part with no index is
// reported as not checked, never as passing.
//
// The EigenPal editors keep the same copy of this file (`fetch.ts`).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PARTS, textDir } from './fetch.ts';

const ROOT = join(import.meta.dir, '..', '..');

/**
 * "ECMA-376 Part 1, 18.3.1.13", "Part 3, 7.2 and 7.6", "Part 1, 18.8.30 and 18.8.31". Not "XML
 * Schema Part 2, 3.3.22", which is a W3C recommendation.
 */
const CITATION =
  /(?<!Schema )\bPart ([1-4]),? (\d+(?:\.\d+)+)((?:(?:,| and|, and) \d+(?:\.\d+)+)*)/g;

function readIndex(part: number): Map<string, string> | undefined {
  const p = PARTS.find((x) => x.part === part);
  const file = p && join(textDir(p), 'index.tsv');
  if (!file || !existsSync(file)) return undefined;
  const index = new Map<string, string>();
  for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
    const [number, title] = line.split('\t');
    if (number) index.set(number, title ?? '');
  }
  return index;
}

const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .stdout.split('\0')
  .filter((f) => f && !f.startsWith('reference/ecma-376/') && f !== 'bun.lock')
  .filter((f) => /\.(ts|tsx|mts|mjs|js|vue|md|mdx|json|yml|yaml|css)$/.test(f));

const indexes = new Map<number, Map<string, string> | undefined>();
const unknown: string[] = [];
const listed: string[] = [];
const unchecked = new Set<number>();

for (const file of tracked) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  text.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(CITATION)) {
      const part = Number(m[1]);
      if (!indexes.has(part)) indexes.set(part, readIndex(part));
      const index = indexes.get(part);
      const numbers = [m[2]!, ...(m[3]?.match(/\d+(?:\.\d+)+/g) ?? [])];
      for (const n of numbers) {
        const where = `${file}:${i + 1}: Part ${part}, ${n}`;
        if (!index) unchecked.add(part);
        else if (!index.has(n)) unknown.push(where);
        else listed.push(`${where} = ${index.get(n)}`);
      }
    }
  });
}

if (process.argv.includes('--list')) for (const line of listed) console.log(line);
for (const part of unchecked)
  console.log(`citations: Part ${part} has no local index; run \`bun run reference:fetch\``);
for (const line of unknown) console.log(`citations: not a subclause of the 5th edition: ${line}`);
console.log(
  `citations: ${listed.length} found in the index, ${unknown.length} not found, ` +
    `${unchecked.size} part(s) not checked`
);
process.exit(unknown.length > 0 || unchecked.size > 0 ? 1 : 0);
