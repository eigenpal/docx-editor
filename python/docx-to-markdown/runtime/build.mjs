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
import { cpSync, mkdirSync, rmSync, readdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNotices } from './notices.mjs';

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
const bundleArgs = [
  // The converter's own tsconfig maps core subpaths to TypeScript source for its tests.
  // This package's tsconfig has no such paths, so Bun bundles the published dist.
  `--tsconfig-override=${join(packageRoot, 'tsconfig.json')}`,
  // The shaper reads `harfbuzz.wasm` from beside the bundle by its original name.
  '--asset-naming=[name].[ext]',
  join(here, 'main.ts'),
];
const build = spawnSync(
  'bun',
  [
    'build',
    '--compile',
    ...(target ? [`--target=${target}`] : []),
    '--outfile',
    binary,
    ...bundleArgs,
  ],
  { cwd: packageRoot, stdio: 'inherit' }
);
if (build.status !== 0) process.exit(build.status ?? 1);

// A second, non-compiled build of the same graph writes the metafile the notices need;
// `--compile` does not emit one.
const scratch = mkdtempSync(join(tmpdir(), 'docx-to-markdown-meta-'));
const metafile = join(scratch, 'meta.json');
const meta = spawnSync(
  'bun',
  ['build', '--target=bun', `--outdir=${scratch}`, `--metafile=${metafile}`, ...bundleArgs],
  { cwd: packageRoot, stdio: ['ignore', 'ignore', 'inherit'] }
);
if (meta.status !== 0) process.exit(meta.status ?? 1);

for (const file of readdirSync(join(fontsRoot, 'assets'))) {
  if (/\.(?:ttf|otf)$/.test(file))
    cpSync(join(fontsRoot, 'assets', file), join(vendor, 'fonts', file));
}
cpSync(join(fontsRoot, 'licenses'), join(vendor, 'licenses'), { recursive: true });
// Snapshot the pinned Google Fonts catalog so Python can say up front whether
// `google_fonts=True` can serve a family, without starting the runtime.
const catalog = spawnSync(
  'bun',
  [
    '-e',
    "import { GOOGLE_FONT_FAMILIES, GOOGLE_METRIC_SUBSTITUTES, GOOGLE_FONTS_REVISION } from '@docx-editor.dev/fonts/google';" +
      'console.log(JSON.stringify({ revision: GOOGLE_FONTS_REVISION, families: GOOGLE_FONT_FAMILIES, substitutes: GOOGLE_METRIC_SUBSTITUTES }))',
  ],
  { cwd: packageRoot, encoding: 'utf8' }
);
if (catalog.status !== 0) {
  console.error(catalog.stderr);
  process.exit(catalog.status ?? 1);
}
writeFileSync(join(vendor, 'google-fonts.json'), catalog.stdout);

const bunVersion = spawnSync('bun', ['--version'], { encoding: 'utf8' }).stdout.trim();
const bundled = writeNotices({
  metafilePath: metafile,
  cwd: packageRoot,
  vendorLicensesDir: join(vendor, 'licenses'),
  bunVersion,
});
rmSync(scratch, { recursive: true, force: true });
console.log(`built ${binary}`);
console.log(`third-party notices cover ${bundled.length} bundled packages: ${bundled.join(', ')}`);
