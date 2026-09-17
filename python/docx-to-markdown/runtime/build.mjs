// Build the vendored runtime for the Python package: one Bun executable, the packaged
// font files, and the license texts that must travel with them.
//
//   node runtime/build.mjs [--target bun-linux-x64]
//
// Run `bun run build:packages` at the repository root first; the entry imports the
// published `dist/` of core, fonts, and the converter. Without `--target`, Bun compiles
// for the current machine. Output lands in `src/docx_to_markdown/_vendor/`, which the
// wheel build hook requires and git ignores.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const vendor = join(packageRoot, 'src', 'docx_to_markdown', '_vendor');
const require = createRequire(import.meta.url);
const fontsRoot = dirname(require.resolve('@docx-editor.dev/fonts/package.json'));

const args = process.argv.slice(2);
const targetIndex = args.indexOf('--target');
const target = targetIndex === -1 ? undefined : args[targetIndex + 1];
if (targetIndex !== -1 && !target) {
  console.error('--target needs a value such as bun-linux-x64');
  process.exit(1);
}
const windows = target ? target.includes('windows') : process.platform === 'win32';

rmSync(vendor, { recursive: true, force: true });
mkdirSync(join(vendor, 'fonts'), { recursive: true });
mkdirSync(join(vendor, 'licenses'), { recursive: true });

const binary = join(vendor, windows ? 'docx-to-markdown.exe' : 'docx-to-markdown');
const build = spawnSync(
  'bun',
  [
    'build',
    '--compile',
    ...(target ? [`--target=${target}`] : []),
    // The shaper reads `harfbuzz.wasm` from beside the bundle by its original name.
    '--asset-naming=[name].[ext]',
    '--outfile',
    binary,
    join(here, 'main.ts'),
  ],
  { cwd: packageRoot, stdio: 'inherit' }
);
if (build.status !== 0) process.exit(build.status ?? 1);

for (const file of readdirSync(join(fontsRoot, 'assets'))) {
  if (/\.(?:ttf|otf)$/.test(file)) cpSync(join(fontsRoot, 'assets', file), join(vendor, 'fonts', file));
}
cpSync(join(fontsRoot, 'licenses'), join(vendor, 'licenses'), { recursive: true });
for (const name of ['THIRD_PARTY_NOTICES.md']) {
  for (const pkg of ['@docx-editor.dev/core', '@docx-editor.dev/docx-to-markdown', '@docx-editor.dev/fonts']) {
    const source = join(dirname(require.resolve(`${pkg}/package.json`)), name);
    if (existsSync(source)) {
      cpSync(source, join(vendor, 'licenses', `${pkg.split('/')[1]}-${name}`));
    }
  }
}
console.log(`built ${binary}`);
