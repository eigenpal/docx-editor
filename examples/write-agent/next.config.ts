import type { NextConfig } from 'next';
import path from 'path';

const workspaceRoot = path.resolve(__dirname, '../..');
const packageDist = (packageName: string, entry: string) =>
  path.join(workspaceRoot, 'packages', packageName, 'dist', entry);
const workspaceAliases = {
  '@docx-editor.dev/core$': packageDist('core', 'index.js'),
  '@docx-editor.dev/core/automation$': packageDist('core', 'automation.js'),
  '@docx-editor.dev/core/binding$': packageDist('core', 'binding.js'),
  '@docx-editor.dev/core/contracts/document$': packageDist('core', 'contracts/document.js'),
  '@docx-editor.dev/core/contracts/editor$': packageDist('core', 'contracts/editor.js'),
  '@docx-editor.dev/core/contracts/interaction$': packageDist('core', 'contracts/interaction.js'),
  '@docx-editor.dev/core/contracts/modules$': packageDist('core', 'contracts/modules.js'),
  '@docx-editor.dev/core/contracts/types$': packageDist('core', 'contracts/types.js'),
  '@docx-editor.dev/core/editor$': packageDist('core', 'editor.js'),
  '@docx-editor.dev/core/layout$': packageDist('core', 'layout.js'),
  '@docx-editor.dev/core/output$': packageDist('core', 'output.js'),
  '@docx-editor.dev/core/store$': packageDist('core', 'store.js'),
  '@docx-editor.dev/editor-api$': packageDist('editor-api', 'index.mjs'),
  '@docx-editor.dev/editor-api/browser$': packageDist('editor-api', 'browser.mjs'),
  '@docx-editor.dev/pro$': packageDist('pro', 'index.js'),
  '@docx-editor.dev/pro/react$': packageDist('pro', 'react/index.js'),
  '@docx-editor.dev/react$': packageDist('react', 'index.mjs'),
};

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  typescript: {
    tsconfigPath: 'tsconfig.next.json',
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...workspaceAliases,
    };
    return config;
  },
};

export default nextConfig;
