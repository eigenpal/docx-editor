#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'docx-editor-consumers-'));
const packDir = path.join(tempRoot, 'packs');
// The Vue consumer app that used to sit alongside the React one is gone while
// @docx-editor.dev/vue is WIP and unpublished — there is no tarball for a real
// consumer to install. Restore it when the package ships again.
const reactAppDir = path.join(tempRoot, 'react-app');

function coreContractPaths(projectDir) {
  const publicEntries = {
    '@docx-editor.dev/core': 'packages/core/src/index.ts',
    '@docx-editor.dev/core/editor': 'packages/core/src/editor.ts',
    '@docx-editor.dev/core/geometry': 'packages/core/src/geometry.ts',
    '@docx-editor.dev/core/plugin': 'packages/core/src/plugin.ts',
    '@docx-editor.dev/core/mcp': 'packages/core/src/mcp.ts',
    '@docx-editor.dev/core/types': 'packages/core/src/types-barrel.ts',
  };
  return Object.fromEntries(
    Object.entries(publicEntries).map(([specifier, relativeTarget]) => [
      specifier,
      [path.relative(projectDir, path.join(ROOT, relativeTarget))],
    ])
  );
}

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

function packPackage(packagePath) {
  const output = run(
    'npm',
    ['pack', path.join(ROOT, packagePath), '--json', '--pack-destination', packDir],
    { capture: true }
  );
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

  // `@docx-editor.dev/core` ships from a separate repo, so it is not packed
  // here — npm resolves it from the registry as a transitive dep, which is
  // what a real consumer gets.
  const sharedTarballs = [packPackage('packages/i18n'), packPackage('packages/editor-api')];
  const reactTarballs = [...sharedTarballs, packPackage('packages/react')];

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
  writeFileSync(
    path.join(reactAppDir, 'src/main.tsx'),
    `import { createRoot } from 'react-dom/client';
import { DocxEditor } from '@docx-editor.dev/react';
import * as ReactUi from '@docx-editor.dev/react/ui';
import * as ReactDialogs from '@docx-editor.dev/react/dialogs';
import * as ReactHooks from '@docx-editor.dev/react/hooks';
import * as ReactPluginApi from '@docx-editor.dev/react/plugin-api';
import '@docx-editor.dev/react/styles.css';

const exportedSurfaceChecks = [ReactUi, ReactDialogs, ReactHooks, ReactPluginApi];
console.assert(exportedSurfaceChecks.every((entry) => typeof entry === 'object' && entry !== null));
void exportedSurfaceChecks;

createRoot(document.getElementById('root')!).render(<DocxEditor showToolbar={false} />);
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
          baseUrl: '.',
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
          skipLibCheck: true,
          paths: coreContractPaths(reactAppDir),
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
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
      'vite',
      'typescript',
      ...reactTarballs,
    ],
    { cwd: reactAppDir }
  );
  run('npm', ['run', 'build'], { cwd: reactAppDir });
  console.log('Fresh React consumer install/build passed.');
} finally {
  if (process.env.KEEP_CONSUMER_INSTALL_TEMP !== '1') {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept temp app at ${reactAppDir}`);
  }
}
