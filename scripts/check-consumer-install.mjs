#!/usr/bin/env node
//
// Installs the packages the way a consumer does — from tarballs, into an empty project,
// with npm resolving what it finds inside them — and builds a real app against the result.
//
// This is the only check that reads a published manifest rather than a workspace one, so
// it is the only place a `workspace:` range, a missing `exports` subpath or a `files` list
// that drops a needed file can fail before a user hits it.
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'docx-editor-consumers-'));
const packDir = path.join(tempRoot, 'packs');
const reactAppDir = path.join(tempRoot, 'react-app');
const vueAppDir = path.join(tempRoot, 'vue-app');
const stagedPackagesDir = path.join(tempRoot, 'staged-packages');

const bumpRank = { patch: 1, minor: 2, major: 3 };

// This check runs before `changeset version`. Stage the versions that the fixed group will
// publish, so a peer floor for that pending release is tested against matching local tarballs.
function nextVersion(version, bump) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

function pendingPackageVersions() {
  const changesetDir = path.join(ROOT, '.changeset');
  const bumps = new Map();
  for (const file of readdirSync(changesetDir).filter((name) => name.endsWith('.md'))) {
    const frontmatter = /^---\n([\s\S]*?)\n---/.exec(
      readFileSync(path.join(changesetDir, file), 'utf8')
    )?.[1];
    if (!frontmatter) continue;
    for (const match of frontmatter.matchAll(
      /^['"]?(@docx-editor\.dev\/[^'":]+)['"]?: (patch|minor|major)$/gm
    )) {
      const [, name, bump] = match;
      const current = bumps.get(name);
      if (!current || bumpRank[bump] > bumpRank[current]) bumps.set(name, bump);
    }
  }
  const config = JSON.parse(readFileSync(path.join(changesetDir, 'config.json'), 'utf8'));
  for (const group of config.fixed ?? []) {
    const groupBump = group
      .map((name) => bumps.get(name))
      .filter(Boolean)
      .sort((a, b) => bumpRank[b] - bumpRank[a])[0];
    if (groupBump) for (const name of group) bumps.set(name, groupBump);
  }
  const versions = new Map();
  for (const [name, bump] of bumps) {
    const packageDir = readdirSync(path.join(ROOT, 'packages'))
      .map((entry) => path.join(ROOT, 'packages', entry))
      .find((dir) => {
        try {
          return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name === name;
        } catch {
          return false;
        }
      });
    if (!packageDir) continue;
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    versions.set(name, nextVersion(manifest.version, bump));
  }
  return versions;
}

const pendingVersions = pendingPackageVersions();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
    env: { ...process.env, ...options.env },
  });
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result.stdout ?? '';
}

// A `~x.y.z` range's satisfaction for a staged internal version, without a semver dep.
// Only the tilde form appears in this repo's internal peer floors; anything else is
// treated as unsatisfied so the staging below rewrites it the way `changeset version`
// would rather than shipping a tarball npm refuses.
function tildeRangeSatisfies(range, version) {
  const match = /^~(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!match) return false;
  const [major, minor, patch] = version.split('.').map(Number);
  return Number(match[1]) === major && Number(match[2]) === minor && patch >= Number(match[3]);
}

function packPackage(packagePath) {
  const source = path.join(ROOT, packagePath);
  const manifest = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const pendingVersion = pendingVersions.get(manifest.name);
  // Mirror what `changeset version` will publish: the bumped version AND, for a bump that
  // leaves a peer floor behind (a minor over a `~x.y.z` floor), the rewritten floor.
  // Staging only the version made every adapter tarball peer-refuse the core tarball on
  // any pending minor, while the real release rewrites the floor in the same commit.
  const stagedPeers = {};
  let peersChanged = false;
  for (const [peerName, range] of Object.entries(manifest.peerDependencies ?? {})) {
    const peerPending = pendingVersions.get(peerName);
    if (peerPending && !tildeRangeSatisfies(range, peerPending)) {
      stagedPeers[peerName] = `~${peerPending}`;
      peersChanged = true;
    } else {
      stagedPeers[peerName] = range;
    }
  }
  let packSource = source;
  if ((pendingVersion && pendingVersion !== manifest.version) || peersChanged) {
    mkdirSync(stagedPackagesDir, { recursive: true });
    packSource = path.join(stagedPackagesDir, path.basename(packagePath));
    cpSync(source, packSource, { recursive: true });
    const staged = {
      ...manifest,
      ...(pendingVersion ? { version: pendingVersion } : {}),
      ...(manifest.peerDependencies ? { peerDependencies: stagedPeers } : {}),
    };
    writeFileSync(path.join(packSource, 'package.json'), `${JSON.stringify(staged, null, 2)}\n`);
  }
  const output = run('npm', ['pack', packSource, '--json', '--pack-destination', packDir], {
    capture: true,
  });
  const [packed] = JSON.parse(output);
  if (!packed?.filename) throw new Error(`npm pack returned no filename for ${packagePath}`);
  return path.join(packDir, packed.filename);
}

try {
  if (process.env.SKIP_CONSUMER_INSTALL_BUILD !== '1') {
    run('bun', ['run', 'build'], {
      env: { NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=8192' },
    });
  }

  mkdirSync(packDir, { recursive: true });

  // Every published package, including the ones the app below only imports for their
  // types: an unpublished version of any of them turns into a registry lookup during
  // install, and the registry has nothing to give.
  const tarballs = [
    packPackage('packages/i18n'),
    packPackage('packages/core'),
    packPackage('packages/react'),
    packPackage('packages/vue'),
    packPackage('packages/fonts'),
    packPackage('packages/editor-api'),
    packPackage('packages/pro'),
  ];

  mkdirSync(path.join(reactAppDir, 'src'), { recursive: true });
  writeFileSync(
    path.join(reactAppDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: {
          typecheck: 'tsc --noEmit',
          build: 'npm run typecheck && vite build',
        },
        dependencies: {},
        devDependencies: {},
      },
      null,
      2
    )
  );
  writeFileSync(
    path.join(reactAppDir, 'index.html'),
    '<div id="root"></div><script type="module" src="/src/main.tsx"></script>\n'
  );
  // The imports are the contract: the packaged editor, the engine the adapter holds as a
  // peer, the stylesheet (which ships from the engine, not the adapter), the fonts, and
  // the two licensed packages. A subpath that stops being exported fails here.
  writeFileSync(
    path.join(reactAppDir, 'src/main.tsx'),
    `import { createRoot } from 'react-dom/client';
import { DocxEditor } from '@docx-editor.dev/react';
import * as Engine from '@docx-editor.dev/core';
import * as EngineEditor from '@docx-editor.dev/core/editor';
import * as Fonts from '@docx-editor.dev/fonts';
import * as EditorApi from '@docx-editor.dev/editor-api';
import * as Collaboration from '@docx-editor.dev/pro/collaboration';
import * as CollaborationWebrtc from '@docx-editor.dev/pro/collaboration/webrtc';
import * as CollaborationHocuspocus from '@docx-editor.dev/pro/collaboration/hocuspocus';
import * as Pro from '@docx-editor.dev/pro';
import * as ProReact from '@docx-editor.dev/pro/react';
import '@docx-editor.dev/core/styles/editor.css';

const exportedSurfaceChecks = [
  Engine,
  EngineEditor,
  Fonts,
  EditorApi,
  Collaboration,
  CollaborationWebrtc,
  CollaborationHocuspocus,
  Pro,
  ProReact,
];
console.assert(exportedSurfaceChecks.every((entry) => typeof entry === 'object' && entry !== null));
void exportedSurfaceChecks;

createRoot(document.getElementById('root')!).render(<DocxEditor />);
`
  );
  writeFileSync(
    path.join(reactAppDir, 'src/vite-env.d.ts'),
    '/// <reference types="vite/client" />\n'
  );
  writeFileSync(
    path.join(reactAppDir, 'vite.config.ts'),
    `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()] });
`
  );
  writeFileSync(
    path.join(reactAppDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts', 'src/**/*.tsx'],
      },
      null,
      2
    )
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      'react',
      'react-dom',
      'yjs',
      'y-protocols',
      'y-webrtc',
      '@hocuspocus/provider',
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
      'vite',
      'typescript',
      ...tarballs,
    ],
    { cwd: reactAppDir }
  );
  run('npm', ['run', 'build'], { cwd: reactAppDir });

  // The consumer has NO Tailwind and no PostCSS — exactly the host the shipped
  // stylesheet must carry on its own. Assert the CSS vite emitted is the compiled,
  // `.docx-editor`-scoped artifact: a raw `@tailwind` directive here means the chrome
  // ships unstyled to Tailwind-less hosts and doubly-styled to Tailwind hosts.
  const assetsDir = path.join(reactAppDir, 'dist', 'assets');
  const emittedCss = readdirSync(assetsDir)
    .filter((name) => name.endsWith('.css'))
    .map((name) => readFileSync(path.join(assetsDir, name), 'utf8'))
    .join('\n');
  if (emittedCss.length === 0) {
    throw new Error('consumer build emitted no CSS asset');
  }
  // The emitted CSS is MINIFIED: quotes drop from attribute selectors and the file is
  // one line, so every check below is written against the minified shape.
  const minified = emittedCss.replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@tailwind\b/.test(minified)) {
    throw new Error('consumer CSS still contains a raw @tailwind directive');
  }
  if (!/\.docx-editor \.flex\b/.test(minified)) {
    throw new Error('consumer CSS is missing .docx-editor-scoped utilities');
  }
  if (!/\.docx-editor \[contenteditable=["']?true["']?\]/.test(minified)) {
    throw new Error('consumer CSS is missing the scoped [contenteditable] caret rule');
  }
  // A selector STARTING with [contenteditable (after {, }, comma, or file start)
  // would reach every rich-text field in a host app.
  if (/(^|[{},])\s*\[contenteditable/.test(minified)) {
    throw new Error('consumer CSS contains an unscoped [contenteditable] rule');
  }
  console.log('Fresh React consumer install/build passed (CSS compiled and scoped).');

  mkdirSync(path.join(vueAppDir, 'src'), { recursive: true });
  writeFileSync(
    path.join(vueAppDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: {
          typecheck: 'tsc --noEmit',
          build: 'npm run typecheck && vite build',
        },
        dependencies: {},
        devDependencies: {},
      },
      null,
      2
    )
  );
  writeFileSync(
    path.join(vueAppDir, 'index.html'),
    '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n'
  );
  writeFileSync(
    path.join(vueAppDir, 'src/main.ts'),
    `import { createApp, h } from 'vue';
import { DocxEditor } from '@docx-editor.dev/vue';
import * as Engine from '@docx-editor.dev/core';
import * as EngineEditor from '@docx-editor.dev/core/editor';
import * as Fonts from '@docx-editor.dev/fonts';
import * as EditorApi from '@docx-editor.dev/editor-api';
import * as Pro from '@docx-editor.dev/pro';
import * as ProVue from '@docx-editor.dev/pro/vue';
import '@docx-editor.dev/core/styles/editor.css';

const exportedSurfaceChecks = [Engine, EngineEditor, Fonts, EditorApi, Pro, ProVue];
console.assert(exportedSurfaceChecks.every((entry) => typeof entry === 'object' && entry !== null));
void exportedSurfaceChecks;

createApp({ render: () => h(DocxEditor) }).mount('#app');
`
  );
  writeFileSync(
    path.join(vueAppDir, 'src/vite-env.d.ts'),
    '/// <reference types="vite/client" />\n'
  );
  writeFileSync(
    path.join(vueAppDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2
    )
  );
  run(
    'npm',
    [
      'install',
      '--ignore-scripts',
      'vue',
      'yjs',
      'y-protocols',
      'y-webrtc',
      '@hocuspocus/provider',
      'vite',
      'typescript',
      ...tarballs,
    ],
    { cwd: vueAppDir }
  );
  run('npm', ['run', 'build'], { cwd: vueAppDir });
  console.log('Fresh Vue consumer install/build passed.');
} finally {
  if (process.env.KEEP_CONSUMER_INSTALL_TEMP !== '1') {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept temp apps at ${reactAppDir} and ${vueAppDir}`);
  }
}
