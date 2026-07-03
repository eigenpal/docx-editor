#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'docx-editor-consumers-'));
const packDir = path.join(tempRoot, 'packs');
const appDir = path.join(tempRoot, 'app');
const reactAppDir = path.join(tempRoot, 'react-app');

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
  mkdirSync(path.join(appDir, 'src'), { recursive: true });

  const sharedTarballs = [
    packPackage('packages/core'),
    packPackage('packages/i18n'),
    packPackage('packages/agents'),
  ];
  const vueTarballs = [...sharedTarballs, packPackage('packages/vue')];
  const reactTarballs = [...sharedTarballs, packPackage('packages/react')];

  writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: {
          typecheck: 'vue-tsc --noEmit',
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
    path.join(appDir, 'index.html'),
    '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n'
  );
  writeFileSync(
    path.join(appDir, 'src/App.vue'),
    `<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor } from '@eigenpal/docx-editor-vue';
import { caretAt, rectsFor, renderDocument } from '@eigenpal/docx-editor-core/api';
import '@eigenpal/docx-editor-vue/styles.css';

const buffer = ref<ArrayBuffer | null>(null);
console.assert(
  typeof renderDocument === 'function' &&
    typeof caretAt === 'function' &&
    typeof rectsFor === 'function'
);

async function loadFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  buffer.value = file ? await file.arrayBuffer() : null;
}
</script>

<template>
  <input type="file" accept=".docx" @change="loadFile" />
  <DocxEditor :document-buffer="buffer" mode="editing" />
</template>
`
  );
  writeFileSync(
    path.join(appDir, 'src/main.ts'),
    `import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#app');
`
  );
  writeFileSync(
    path.join(appDir, 'vite.config.ts'),
    `import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({ plugins: [vue()] });
`
  );
  writeFileSync(
    path.join(appDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'preserve',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts', 'src/**/*.vue'],
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
      'vue-tsc',
      '@vitejs/plugin-vue',
      'vite',
      // vue-tsc currently requires TypeScript's 5.x compiler internals.
      'typescript@5.9.3',
      ...vueTarballs,
    ],
    { cwd: appDir }
  );
  run('npm', ['run', 'build'], { cwd: appDir });
  console.log('Fresh Vue consumer install/build passed.');

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
import { DocxEditor } from '@eigenpal/docx-editor-react';
import { caretAt, rectsFor, renderDocument } from '@eigenpal/docx-editor-core/api';
import '@eigenpal/docx-editor-react/styles.css';

console.assert(
  typeof renderDocument === 'function' &&
    typeof caretAt === 'function' &&
    typeof rectsFor === 'function'
);

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
    console.log(`Kept temp apps at ${appDir} and ${reactAppDir}`);
  }
}
