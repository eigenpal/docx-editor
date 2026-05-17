#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const tempRoot = mkdtempSync(path.join(tmpdir(), 'docx-editor-vue-consumer-'));
const packDir = path.join(tempRoot, 'packs');
const appDir = path.join(tempRoot, 'app');

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

  const tarballs = [
    packPackage('packages/core'),
    packPackage('packages/i18n'),
    packPackage('packages/agent-use'),
    packPackage('packages/vue'),
  ];

  writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: { build: 'vite build' },
        dependencies: {},
        devDependencies: {},
      },
      null,
      2
    )
  );

  writeFileSync(path.join(appDir, 'index.html'), '<div id="app"></div><script type="module" src="/src/main.ts"></script>\n');
  writeFileSync(
    path.join(appDir, 'src/App.vue'),
    `<script setup lang="ts">
import { ref } from 'vue';
import { DocxEditor } from '@eigenpal/docx-editor-vue';
import '@eigenpal/docx-editor-vue/styles.css';

const buffer = ref<ArrayBuffer | null>(null);

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
          types: ['vite/client'],
        },
        include: ['src/**/*.ts', 'src/**/*.vue', 'vite.config.ts'],
      },
      null,
      2
    )
  );

  run('npm', ['install', '--ignore-scripts', 'vue', '@vitejs/plugin-vue', 'vite', 'typescript', ...tarballs], {
    cwd: appDir,
  });
  run('npm', ['run', 'build'], { cwd: appDir });
  console.log('Fresh Vue consumer install/build passed.');
} finally {
  if (process.env.KEEP_CONSUMER_INSTALL_TEMP !== '1') {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept temp app at ${appDir}`);
  }
}
