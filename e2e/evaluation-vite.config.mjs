/** Compile the existing browser harness before starting Chromium. */
import { resolve } from 'node:path';
import original from '../examples/vite/vite.config.ts';

export default async () => {
  const config = await (typeof original === 'function'
    ? original({ command: 'build', mode: 'production' })
    : original);
  return {
    ...config,
    root: resolve(import.meta.dirname, '..'),
    publicDir: false,
    envDir: false,
    // The fixture plugin emits unrelated documents. Inputs arrive through interception.
    plugins: config.plugins?.filter(
      (plugin) =>
        !plugin ||
        typeof plugin !== 'object' ||
        !('name' in plugin) ||
        plugin.name !== 'docx-editor-canonical-fixture'
    ),
    build: {
      ...config.build,
      minify: false,
      sourcemap: false,
      rollupOptions: { input: resolve(import.meta.dirname, 'evaluation-browser.html') },
    },
  };
};
