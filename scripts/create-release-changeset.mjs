#!/usr/bin/env node
// Generates an ad-hoc changeset for the fixed release group declared in
// .changeset/config.json so a manual workflow_dispatch run can force a
// bump level (e.g. minor or major) even when all per-PR changesets are
// patch. The body is empty on purpose — per-PR changesets supply the
// CHANGELOG entries, and an extra "Release" line here would just be
// noise.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const bump = process.argv[2];

if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error(`Invalid bump "${bump}". Expected: patch | minor | major`);
  process.exit(1);
}

const cwd = process.cwd();
const config = JSON.parse(readFileSync(resolve(cwd, '.changeset/config.json'), 'utf8'));
const group = config.fixed?.[0];
if (!Array.isArray(group) || group.length === 0) {
  console.error('No fixed release group found in .changeset/config.json');
  process.exit(1);
}

const dir = resolve(cwd, '.changeset');
mkdirSync(dir, { recursive: true });

const frontmatter = group.map((name) => `"${name}": ${bump}`).join('\n');
// Empty body — `changeset version` accepts this and the bump still applies,
// but no extra entry pollutes the CHANGELOG.
const body = `---\n${frontmatter}\n---\n`;

const file = resolve(dir, `release-${Date.now()}.md`);
writeFileSync(file, body, 'utf8');
console.log(`Created ${file} (${bump}, no body) for ${group.join(', ')}`);
