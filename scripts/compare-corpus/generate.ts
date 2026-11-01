/**
 * Generates the synthetic compare corpus: one (base, revised) DOCX pair per case.
 *
 *   bun scripts/compare-corpus/generate.ts --out <dir> [--only <family>] [--list]
 *
 * Output: <dir>/<family>/<case>/{base.docx,revised.docx}, plus <dir>/manifest.json with a
 * SHA-256 per input so a reference recorded for one generator version is never applied to
 * different inputs.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDocx } from './docx-builder.ts';
import { allCases } from './cases.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const only = flag('--only');
const cases = allCases().filter((item) => !only || item.family === only);

if (args.includes('--list')) {
  const counts = new Map<string, number>();
  for (const item of cases) counts.set(item.family, (counts.get(item.family) ?? 0) + 1);
  for (const [family, count] of counts) console.log(`${family.padEnd(22)} ${count}`);
  console.log(`${'total'.padEnd(22)} ${cases.length}`);
  process.exit(0);
}

const out = flag('--out');
if (!out) {
  console.error('usage: generate.ts --out <dir> [--only <family>] [--list]');
  process.exit(2);
}
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const manifest: Array<{ family: string; name: string; base: string; revised: string }> = [];
for (const item of cases) {
  const dir = join(out, item.family, item.name);
  mkdirSync(dir, { recursive: true });
  const base = buildDocx(item.base);
  const revised = buildDocx(item.revised);
  writeFileSync(join(dir, 'base.docx'), base);
  writeFileSync(join(dir, 'revised.docx'), revised);
  manifest.push({ family: item.family, name: item.name, base: sha(base), revised: sha(revised) });
}
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`wrote ${manifest.length} pairs to ${out}`);
