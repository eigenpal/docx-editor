#!/usr/bin/env node
/**
 * Guards the shape every example README shares, so a reader can find the run
 * steps in the same place in all of them.
 *
 * Each runnable example needs:
 *   1. an H1 title
 *   2. a lead paragraph directly under it, before any heading or fence
 *   3. a `## Run the example` section
 *
 * The first two are not decoration. https://www.docx-editor.dev/examples reads
 * exactly that title and paragraph out of these files to describe each example,
 * so an example that opens with a fence or a subheading lists on the site with
 * no description at all.
 *
 * If this fails, the fix is in the README, not here. Directories that are not
 * examples a reader runs go in NOT_EXAMPLES below, with a reason.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXAMPLES = join(repoRoot, 'examples');

const RUN_HEADING = '## Run the example';

/** Directories under examples/ that nobody clones and runs on their own. */
const NOT_EXAMPLES = new Map([
  ['shared', 'reusable components for the other examples, not runnable'],
  ['parity', 'deployment harness that serves two other examples from one origin'],
]);

/** The parts of a README this check and the website both depend on. */
function parse(markdown) {
  const lines = markdown.split('\n');

  const headingIndex = lines.findIndex((l) => l.startsWith('# '));
  if (headingIndex === -1) return { title: null, lead: null, hasRunSection: false };

  const lead = [];
  for (const line of lines.slice(headingIndex + 1)) {
    const text = line.trim();
    if (!text) {
      if (lead.length) break;
      continue;
    }
    if (text.startsWith('#') || text.startsWith('```')) break;
    lead.push(text);
  }

  return {
    title: lines[headingIndex].slice(2).trim(),
    lead: lead.length ? lead.join(' ') : null,
    hasRunSection: lines.some((l) => l.trim() === RUN_HEADING),
  };
}

const failures = [];

for (const name of readdirSync(EXAMPLES).sort()) {
  if (NOT_EXAMPLES.has(name)) continue;

  const readme = join(EXAMPLES, name, 'README.md');
  if (!existsSync(join(EXAMPLES, name, 'package.json'))) continue;

  if (!existsSync(readme)) {
    failures.push(`examples/${name}: no README.md`);
    continue;
  }

  const { title, lead, hasRunSection } = parse(readFileSync(readme, 'utf8'));
  const problems = [];

  if (!title) problems.push('no H1 title');
  if (!lead) {
    problems.push('no lead paragraph between the H1 and the first heading or code fence');
  }
  if (!hasRunSection) problems.push(`no \`${RUN_HEADING}\` section`);

  if (problems.length) {
    failures.push(`examples/${name}/README.md: ${problems.join('; ')}`);
  }
}

if (failures.length) {
  console.error('✘ example READMEs do not share the expected shape:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  console.error(
    `\nEvery runnable example opens with an H1, one paragraph describing it, and a` +
      `\n\`${RUN_HEADING}\` section with the commands. docx-editor.dev reads the title and` +
      `\nthat paragraph to describe the example, so both have to be there.`,
  );
  process.exit(1);
}

console.log('✓ example READMEs share the expected shape (title, lead, run section).');
