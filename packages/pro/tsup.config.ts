import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Options } from 'tsup';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Write this build's metafile under a name of its own.
 *
 * tsup runs an array config CONCURRENTLY (`Promise.all`) and names the file it writes
 * after the format alone — `dist/metafile-${format}.json`. Two configs that share a
 * format therefore write the same two paths at the same time. The usual outcome is a
 * clobber: whichever build finishes last owns the file, and the other build's inputs
 * vanish from the record `scripts/generate-third-party-notices.mjs` reads. The
 * occasional outcome is worse — the two writes interleave and the file is not JSON at
 * all, which fails the notices gate and blocks the release.
 *
 * So only the first config lets tsup write the metafile. This build asks esbuild for
 * one (`options.metafile` below) and writes it here, under a name no other config in
 * the array claims. The generator globs `metafile-*.json`, so it reads both.
 */
const writeMetafileAs = (prefix: string): NonNullable<Options['esbuildPlugins']>[number] => {
  // tsup reuses one plugin object for every format it builds from a config, so this
  // closure sees them all. It is the guard that keeps the bug above from coming back
  // by another route: two builds that resolve to the same name fail here, loudly,
  // instead of overwriting each other.
  const written = new Set<string>();
  return {
    name: `write-metafile-as-${prefix}`,
    setup(build) {
      build.onEnd(async (result) => {
        // esbuild fills this in only because `esbuildOptions` asks it to. A config that
        // wires up this plugin and forgets that line would write nothing and say
        // nothing, so it fails instead.
        if (!result.metafile) {
          throw new Error(
            `${prefix}: esbuild produced no metafile. Set \`options.metafile = true\` in ` +
              "this config's `esbuildOptions`, or the third-party notice for this build " +
              'is derived from nothing.'
          );
        }
        // The build's own output extension, not its format. tsup builds CJS by asking
        // esbuild for ESM and converting afterwards whenever `splitting` or `treeshake`
        // is on, so `initialOptions.format` reads `esm` for BOTH builds here — the
        // extension map is the one thing that still tells them apart.
        const extension = build.initialOptions.outExtension?.['.js'];
        if (!extension) {
          throw new Error(
            `${prefix}: tsup set no output extension for this build, so its metafile has ` +
              'no name that another build cannot claim.'
          );
        }
        const name = `metafile-${prefix}-${extension.replace('.', '')}.json`;
        if (written.has(name)) {
          throw new Error(
            `${prefix}: two builds both want to write dist/${name}. One would overwrite ` +
              "the other, and the notice would describe less than the package ships."
          );
        }
        written.add(name);
        const dist = resolve(here, 'dist');
        await mkdir(dist, { recursive: true });
        await writeFile(resolve(dist, name), JSON.stringify(result.metafile), 'utf8');
      });
    },
  };
};

const shared = {
  platform: 'browser' as const,
  format: ['cjs', 'esm'] as ('cjs' | 'esm')[],
  splitting: true,
  sourcemap: false,
  // Neither build may clean: the two run at once, so a `clean` here would delete the
  // other build's output. The package `build` script empties `dist/` before tsup
  // starts, which is the only ordering tsup actually guarantees.
  clean: false,
  treeshake: true,
  minify: true,
  external: [
    '@docx-editor.dev/core',
    '@docx-editor.dev/i18n',
    '@docx-editor.dev/react',
    '@docx-editor.dev/vue',
    'react',
    'react-dom',
    'vue',
  ],
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      'react/index': 'src/react/index.ts',
    },
    dts: true,
    // The one config in this array that may let tsup name the file. See
    // `writeMetafileAs`.
    metafile: true,
  },
  {
    ...shared,
    entry: {
      'vue/index': 'src/vue/index.ts',
    },
    dts: {
      compilerOptions: {
        jsx: 'preserve',
        jsxImportSource: 'vue',
      },
    },
    // Off, so tsup does not write `dist/metafile-${format}.json` over the build above.
    // The plugin writes `dist/metafile-vue-${format}.json` instead.
    metafile: false,
    esbuildPlugins: [writeMetafileAs('vue')],
    esbuildOptions(options) {
      options.jsx = 'automatic';
      options.jsxImportSource = 'vue';
      // Asks esbuild for the metafile that `writeMetafileAs` writes. tsup's own
      // `metafile` option only decides whether TSUP writes one.
      options.metafile = true;
    },
  },
]);
