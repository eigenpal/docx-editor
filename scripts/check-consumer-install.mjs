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

  const sharedTarballs = [packPackage('packages/i18n'), packPackage('packages/agents')];
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
import { DocxEditor, DocxEditorToolbar, useEditorSnapshot } from '@docx-editor.dev/vue';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';

const buffer = ref<ArrayBuffer | null>(null);
void DocxEditorToolbar;
void useEditorSnapshot;

const t = createT(en);
const toolbarBold: TranslationKey = 'toolbar.bold';
void t(toolbarBold);

async function loadFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  buffer.value = file ? await file.arrayBuffer() : null;
}
</script>

<template>
  <input type="file" accept=".docx" @change="loadFile" />
  <DocxEditor :document-buffer="buffer" mode="edit" />
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
          baseUrl: '.',
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'preserve',
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
import {
  DocxEditor,
  DocxEditorToolbar,
  ImageInsertProvider,
  ImageWrap,
  ImageAltText,
  ImagePropertiesTrigger,
  normalizeImageBytes,
  useDocxEditor,
  type ImageWrapTarget,
  type NormalizedImagePayload,
} from '@docx-editor.dev/react';
import { createT, en, type TranslationKey } from '@docx-editor.dev/i18n';

void DocxEditorToolbar;
void useDocxEditor;
void ImageInsertProvider;
void ImageWrap;
void ImageAltText;
void ImagePropertiesTrigger;
void normalizeImageBytes;

const wrapTarget: ImageWrapTarget = 'inline';
const normalized: NormalizedImagePayload = {
  ok: true,
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
  mime: 'image/png',
  widthPoints: 1,
  heightPoints: 1,
};
void wrapTarget;
void normalized;

const t = createT(en);
const toolbarBold: TranslationKey = 'toolbar.bold';
void t(toolbarBold);

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
          baseUrl: '.',
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          jsx: 'react-jsx',
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
      'typescript@5.9.3',
      ...reactTarballs,
    ],
    { cwd: reactAppDir }
  );
  run('npm', ['run', 'build'], { cwd: reactAppDir });
  console.log('Fresh React consumer install/build passed.');

  const agentsAppDir = path.join(tempRoot, 'agents-app');
  mkdirSync(path.join(agentsAppDir, 'src'), { recursive: true });
  writeFileSync(
    path.join(agentsAppDir, 'package.json'),
    JSON.stringify(
      {
        private: true,
        type: 'module',
        scripts: { typecheck: 'tsc --noEmit', build: 'npm run typecheck' },
        dependencies: {},
        devDependencies: {},
      },
      null,
      2
    )
  );
  writeFileSync(
    path.join(agentsAppDir, 'src', 'imports.ts'),
    `import type { DocxReviewer, ReviewChange, AgentToolDefinition } from '@docx-editor.dev/agents';
import type { EditorBridge } from '@docx-editor.dev/agents/server';
import type { AgentPanelProps } from '@docx-editor.dev/agents/vue';
import type { AgentMessage } from '@docx-editor.dev/agents/ai-sdk/vue';
import { getToolDisplayName } from '@docx-editor.dev/agents/vue';
import { getAiSdkTools } from '@docx-editor.dev/agents/ai-sdk/server';
import { toAgentMessages } from '@docx-editor.dev/agents/ai-sdk/react';
import type { McpServer } from '@docx-editor.dev/agents/mcp';

void (null as unknown as DocxReviewer);
void (null as unknown as ReviewChange);
void (null as unknown as AgentToolDefinition);
void (null as unknown as EditorBridge);
void (null as unknown as AgentPanelProps);
void (null as unknown as AgentMessage);
void getToolDisplayName;
void getAiSdkTools;
void toAgentMessages;
void (null as unknown as McpServer);
`
  );
  writeFileSync(
    path.join(agentsAppDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2
    )
  );
  run(
    'npm',
    ['install', '--ignore-scripts', 'typescript@5.9.3', ...sharedTarballs],
    { cwd: agentsAppDir }
  );
  run('npm', ['run', 'build'], { cwd: agentsAppDir });
  console.log('Fresh agents consumer typecheck passed.');
} finally {
  if (process.env.KEEP_CONSUMER_INSTALL_TEMP !== '1') {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept temp apps at ${appDir} and ${reactAppDir}`);
  }
}
