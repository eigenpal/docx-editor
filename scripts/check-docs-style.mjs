import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { checkDocsStyle, checkPackageReadme } from './lib/docs-style.mjs';

const root = resolve(import.meta.dirname, '..');
const files = new Set(['README.md', 'CONTRIBUTING.md']);
const problems = [];
const read = (file) => readFileSync(join(root, file), 'utf8');

function addGuides(directory) {
  if (!existsSync(join(root, directory))) return;
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) addGuides(file);
    else if (/\.mdx?$/.test(file)) files.add(file);
  }
}

let packages = 0;
for (const entry of readdirSync(join(root, 'packages'))) {
  const directory = join('packages', entry);
  const manifestPath = join(directory, 'package.json');
  if (!existsSync(join(root, manifestPath))) continue;
  packages++;
  const manifest = JSON.parse(read(manifestPath));
  const readme = join(directory, 'README.md');
  if (!existsSync(join(root, readme))) {
    problems.push(`${readme}: Add a package README.`);
    continue;
  }
  files.add(readme);
  addGuides(join(directory, 'docs'));
  for (const message of checkPackageReadme(read(readme), manifest)) {
    problems.push(`${readme}: ${message}`);
  }
  if (manifest.private !== true) {
    for (const overview of ['README.md', 'docs/site/content/index.mdx']) {
      if (!read(overview).includes(manifest.name)) {
        problems.push(`${overview}: Add ${manifest.name} to the package list.`);
      }
    }
  }
}

addGuides('docs/site/content');
for (const entry of readdirSync(join(root, 'examples'))) {
  const readme = join('examples', entry, 'README.md');
  if (existsSync(join(root, readme))) files.add(readme);
}

// Explicit file arguments support checking an additional authored guide.
for (const argument of process.argv.slice(2)) files.add(relative(root, resolve(argument)));
for (const file of [...files].sort()) {
  for (const problem of checkDocsStyle(read(file))) {
    problems.push(`${file}:${problem.line}: ${problem.message}`);
  }
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Documentation style: ${files.size} files and ${packages} package READMEs checked.`);
}
