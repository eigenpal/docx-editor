import path from 'path';
import { fileURLToPath } from 'url';

const __configDir = path.dirname(fileURLToPath(import.meta.url));

// Vue builds with vite, whose CSS pass auto-discovers the nearest PostCSS
// config. React instead runs the standalone `tailwindcss` CLI in a separate
// `build:css` step because tsup does not process CSS — so the equivalent for
// Vue is to wire Tailwind into vite's existing PostCSS pass here rather than
// add a separate step (which would clobber the SFC <style> CSS vite emits).
//
// The tailwind config path is absolute so it resolves regardless of the cwd
// the build runs from (see issue #340).
export default {
  plugins: {
    tailwindcss: { config: path.join(__configDir, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
