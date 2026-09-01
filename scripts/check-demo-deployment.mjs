import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apps = [
  ['react', '/react/', ['sample.docx']],
  ['vue', '/vue/', ['sample.docx']],
  ['igloo', '/igloo/', ['sample.docx', 'sample-igloo.docx']],
  ['docx-to-markdown', '/docx-to-markdown/', ['sample.docx']],
];
const hosts = [
  ['igloo.docx-editor.dev', '/igloo/index.html'],
  ['docx-to-markdown.docx-editor.dev', '/docx-to-markdown/index.html'],
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function checkBuiltApp(distDirectory, base, requiredFiles) {
  invariant(base.startsWith('/') && base.endsWith('/'), `invalid app base: ${base}`);
  const distRoot = path.resolve(distDirectory);
  const html = await readFile(path.join(distRoot, 'index.html'), 'utf8');
  const references = [...html.matchAll(/\b(?:content|href|src)="(\/[^"?#]*(?:[?#][^"]*)?)"/g)].map(
    (match) => match[1]
  );

  invariant(references.length > 0, `${base} index.html has no root-relative build references`);
  for (const reference of references) {
    const pathname = new URL(reference, 'https://demo.invalid').pathname;
    invariant(pathname.startsWith(base), `${base} emitted an out-of-base reference: ${reference}`);
    if (pathname.endsWith('/')) continue;
    const target = path.resolve(distRoot, pathname.slice(base.length));
    invariant(target.startsWith(`${distRoot}${path.sep}`), `${base} reference escaped its output`);
    invariant(await fileExists(target), `${base} references a missing build file: ${reference}`);
  }

  for (const required of requiredFiles) {
    invariant(await fileExists(path.join(distRoot, required)), `${base} is missing ${required}`);
  }
}

function findRewrite(rewrites, source, destination, host) {
  return rewrites.findIndex(
    (rewrite) =>
      rewrite.source === source &&
      rewrite.destination === destination &&
      (host === undefined ||
        rewrite.has?.some((condition) => condition.type === 'host' && condition.value === host))
  );
}

function sourceMatches(source, pathname) {
  if (source === '/:path*') return pathname.startsWith('/');
  if (source.endsWith('(.*)')) return pathname.startsWith(source.slice(0, -4));
  return source === pathname;
}

function hostMatches(rewrite, host) {
  const conditions = rewrite.has ?? [];
  return conditions.every((condition) => condition.type !== 'host' || condition.value === host);
}

export function firstRewriteDestination(rewrites, pathname, host) {
  return rewrites.find(
    (rewrite) => sourceMatches(rewrite.source, pathname) && hostMatches(rewrite, host)
  )?.destination;
}

export function assertRoutingContract(rewrites) {
  const crossAppPaths = apps.map(([directory]) => `/${directory}/deep/link`);
  for (const [host, destination] of hosts) {
    for (const pathname of ['/', '/case/deep-link', ...crossAppPaths]) {
      invariant(
        firstRewriteDestination(rewrites, pathname, host) === destination,
        `${host}${pathname} must first rewrite to ${destination}`
      );
    }
  }

  for (const [directory] of apps) {
    const pathname = `/${directory}/deep/link`;
    invariant(
      firstRewriteDestination(rewrites, pathname, 'preview.docx-editor.dev') ===
        `/${directory}/index.html`,
      `${pathname} must first rewrite to /${directory}/index.html`
    );
  }
  invariant(
    firstRewriteDestination(rewrites, '/', 'preview.docx-editor.dev') === '/react/index.html',
    'the primary deployment root must first rewrite to the React demo'
  );
}

async function checkCombinedDeployment() {
  const deploymentRoot = path.join(repositoryRoot, 'examples/parity/dist');

  for (const [directory, base, required] of apps) {
    await checkBuiltApp(path.join(deploymentRoot, directory), base, required);
  }

  invariant(
    !(await fileExists(path.join(deploymentRoot, 'index.html'))),
    'deployment root index.html would bypass the Vercel root and host rewrites'
  );

  const config = JSON.parse(await readFile(path.join(repositoryRoot, 'vercel.json'), 'utf8'));
  const rewrites = config.rewrites ?? [];

  for (const [host, destination] of hosts) {
    const rootIndex = findRewrite(rewrites, '/', destination, host);
    const deepLinkIndex = findRewrite(rewrites, '/:path*', destination, host);
    invariant(rootIndex >= 0, `${host} has no root rewrite to ${destination}`);
    invariant(
      deepLinkIndex > rootIndex,
      `${host} has no ordered deep-link fallback to ${destination}`
    );
  }

  for (const [directory] of apps) {
    invariant(
      findRewrite(rewrites, `/${directory}/(.*)`, `/${directory}/index.html`) >= 0,
      `/${directory}/ has no path-based SPA fallback`
    );
  }
  invariant(
    findRewrite(rewrites, '/', '/react/index.html') >= 0,
    'the primary deployment root must resolve to the React demo'
  );
  assertRoutingContract(rewrites);

  console.log('✓ combined demo deployment: 4 apps, base-safe assets, fixtures, and host fallbacks');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [mode, distDirectory, base, ...requiredFiles] = process.argv.slice(2);
  if (mode === '--app') {
    invariant(distDirectory && base, 'usage: --app <dist-directory> <base> [required-file...]');
    await checkBuiltApp(path.resolve(distDirectory), base, requiredFiles);
    console.log(`✓ demo build: ${base} references and required files resolve`);
  } else {
    invariant(mode === undefined, `unknown argument: ${mode}`);
    await checkCombinedDeployment();
  }
}
