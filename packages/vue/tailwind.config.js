import path from 'path';
import { fileURLToPath } from 'url';

const __configDir = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__configDir, '../..');

// Shared color/theme preset (single source of truth). Prefer the packaged preset;
// fall back to the in-repo source copy when building from the workspace.
const corePreset = (() => {
  try {
    return require('@docx-editor.dev/core/tailwind-preset.cjs');
  } catch {
    return require(path.join(monorepoRoot, 'packages/core/tailwind-preset.cjs'));
  }
})();

/**
 * Vue adapter Tailwind config. Expands the `@tailwind utilities` directive in the shared
 * core stylesheet against the Vue component sources, scoped to `.docx-editor`, sharing the
 * color/theme palette with React via the core preset.
 * @type {import('tailwindcss').Config}
 */
export default {
  presets: [corePreset],
  important: '.docx-editor',
  content: [
    path.join(__configDir, 'src/**/*.{ts,vue}'),
    path.join(monorepoRoot, 'examples/**/*.{ts,vue}'),
  ],
};
