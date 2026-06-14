import path from 'path';
import { fileURLToPath } from 'url';

const __configDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Root config used by the example/demo builds. Shares the color/theme palette
 * with the adapters via the core preset (single source of truth). No
 * `important` scoping here so the demo shell can use utilities freely.
 * @type {import('tailwindcss').Config}
 */
export default {
  presets: [require('./packages/core/tailwind-preset.cjs')],
  // Absolute paths so example builds (cd examples/vite && vite build) still scan the right files.
  content: [
    path.join(__configDir, 'packages/react/src/**/*.{ts,tsx}'),
    path.join(__configDir, 'examples/**/*.{ts,tsx}'),
  ],
};
