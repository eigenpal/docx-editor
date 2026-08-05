// Copies the engine stylesheet into packages/core/dist.
//
// tsup only emits files something imports, and editor.css is a standalone
// asset consumers pull in themselves through the `./styles/editor.css`
// subpath. Copying it here keeps `files: ["dist"]` honest: everything the
// export map points at lives under dist.

import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'core');
const from = join(root, 'src', 'styles', 'editor.css');
const to = join(root, 'dist', 'editor.css');

mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log('core: copied editor.css into dist');
