// Shared API Extractor runner used by `scripts/api-extractor.mjs`. Walks
// a package's `exports` map, builds one `<reportDir>/<slug>.api.md`
// snapshot per public subpath, and shares a single `CompilerState` so
// adding new subpaths doesn't quadratically slow down the run.
//
// Caller passes `reportDir` (where the committed snapshots live —
// `docs/<pkg-slug>/` in this repo) and optionally a custom tsconfig.
// Default tsconfig is `<packageRoot>/tsconfig.json`.

import { CompilerState, Extractor, ExtractorConfig } from '@microsoft/api-extractor';
import fs from 'node:fs';
import path from 'node:path';

function slugForKey(key) {
  if (key === '.') return 'index';
  return key.replace(/^\.\//, '').replace(/\//g, '-');
}

function sourcePathForEntry(packageRoot, value) {
  // Resolve the src path that produced the dist .d.ts so drift output points
  // a contributor at the file to edit. tsup/vite both write `./dist/<x>.js`
  // from `./src/<x>.ts` or `./src/<x>/index.ts`.
  const importPath = typeof value.import === 'string' ? value.import : null;
  if (!importPath) return null;
  const distRel = importPath.replace(/^\.\/dist\//, '').replace(/\.(m|c)?js$/, '');
  const direct = path.join('src', `${distRel}.ts`);
  if (fs.existsSync(path.join(packageRoot, direct))) return direct;
  const indexed = path.join('src', distRel, 'index.ts');
  if (fs.existsSync(path.join(packageRoot, indexed))) return indexed;
  return direct;
}

function entriesFromExports(packageRoot, exportsMap) {
  const entries = [];
  for (const [key, value] of Object.entries(exportsMap)) {
    if (key === './package.json') continue;
    if (typeof value !== 'object' || value === null) continue;
    if (typeof value.types !== 'string') continue;
    entries.push({
      key,
      dts: value.types,
      slug: slugForKey(key),
      src: sourcePathForEntry(packageRoot, value),
    });
  }
  return entries;
}

/**
 * @param {{
 *   packageRoot: string,
 *   reportDir: string,
 *   isLocal: boolean,
 *   buildHint: string,
 *   tsconfigPath?: string,
 *   emitDocModel?: boolean,
 * }} options
 */
export function runApiExtractor(options) {
  const {
    packageRoot,
    reportDir,
    isLocal,
    buildHint,
    tsconfigPath = path.join(packageRoot, 'tsconfig.json'),
    emitDocModel = false,
  } = options;

  if (!reportDir) {
    // Explicit check — otherwise the failure is `fs.mkdirSync(undefined)`
    // a few lines below, which is cryptic.
    throw new Error('runApiExtractor: reportDir is required');
  }
  if (!packageRoot) {
    throw new Error('runApiExtractor: packageRoot is required');
  }

  const packageJsonPath = path.join(packageRoot, 'package.json');
  const tempDir = path.join(packageRoot, 'temp');
  const docModelDir = path.join(tempDir, 'api-model');
  if (emitDocModel) fs.mkdirSync(docModelDir, { recursive: true });

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const targets = entriesFromExports(packageRoot, pkg.exports || {});

  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const tsdocMessageReporting = {
    'tsdoc-undefined-tag': { logLevel: 'none' },
  };
  // `ae-forgotten-export`: silenced because re-export-heavy barrels and
  // non-rolled-up dist trees (Vue's vite-plugin-dts emits per-file `.d.ts`)
  // surface every internal helper as "forgotten."
  // `ae-missing-release-tag`: warning instead of the default error, so
  // undocumented `@public` exports increment warningCount but don't fail CI.
  const extractorMessageReporting = {
    'ae-forgotten-export': { logLevel: 'none' },
    'ae-missing-release-tag': { logLevel: 'warning' },
  };

  function buildConfig({ dts, slug }) {
    const dtsPath = path.resolve(packageRoot, dts);
    const configObject = {
      mainEntryPointFilePath: dtsPath,
      apiReport: {
        enabled: true,
        reportFolder: reportDir,
        reportFileName: `${slug}.api.md`,
        reportTempFolder: tempDir,
      },
      docModel: emitDocModel
        ? {
            enabled: true,
            // One file per subpath. Otherwise the runner overwrites a single
            // <unscopedPackageName>.api.json between invocations.
            apiJsonFilePath: path.join(docModelDir, `${slug}.api.json`),
          }
        : { enabled: false },
      dtsRollup: { enabled: false },
      tsdocMetadata: { enabled: false },
      compiler: { tsconfigFilePath: tsconfigPath },
      messages: {
        extractorMessageReporting,
        tsdocMessageReporting,
      },
      projectFolder: packageRoot,
    };
    return ExtractorConfig.prepare({
      configObject,
      configObjectFullPath: packageJsonPath,
      packageJsonFullPath: packageJsonPath,
    });
  }

  const present = [];
  const skipped = [];
  for (const target of targets) {
    const dtsPath = path.resolve(packageRoot, target.dts);
    if (fs.existsSync(dtsPath)) {
      present.push(target);
    } else {
      skipped.push(target);
    }
  }

  if (present.length === 0) {
    console.error(`No built .d.ts files found in ${packageRoot}/dist. Run \`${buildHint}\` first.`);
    process.exit(1);
  }

  // Share one CompilerState across every invocation so we only parse tsconfig
  // and walk the dist tree once instead of N times.
  const firstConfig = buildConfig(present[0]);
  const additionalEntryPoints = present
    .slice(1)
    .map((t) => path.resolve(packageRoot, t.dts));
  const compilerState = CompilerState.create(firstConfig, {
    additionalEntryPoints,
  });

  let totalErrors = 0;
  let totalWarnings = 0;
  const driftedEntries = [];

  for (const target of present) {
    const extractorConfig = buildConfig(target);
    const result = Extractor.invoke(extractorConfig, {
      localBuild: isLocal,
      showVerboseMessages: false,
      compilerState,
      messageCallback: (message) => {
        message.handled = true;
      },
    });

    totalErrors += result.errorCount;
    totalWarnings += result.warningCount;

    if (!isLocal && result.apiReportChanged) {
      driftedEntries.push(target);
    }
  }

  console.log(`API Extractor (${pkg.name}): ${present.length} entries scanned`);
  console.log(`  errors: ${totalErrors}`);
  console.log(`  warnings: ${totalWarnings}`);
  if (skipped.length > 0) console.log(`  skipped: ${skipped.length}`);

  if (!isLocal && skipped.length > 0) {
    console.error(`\nMissing dist files for ${skipped.length} entr${skipped.length === 1 ? 'y' : 'ies'}:`);
    for (const t of skipped) console.error(`  - ${t.key} → ${t.dts}`);
    console.error(`\nFix: ${buildHint}`);
    process.exit(1);
  }

  if (driftedEntries.length > 0) {
    console.error(
      `\nAPI surface drift in ${driftedEntries.length} entr${driftedEntries.length === 1 ? 'y' : 'ies'}:`
    );
    for (const t of driftedEntries) {
      const where = t.src ? ` (${t.src})` : '';
      console.error(`  - ${t.slug}${where}`);
    }
    console.error(`\nFix: bun run api:extract`);
    console.error(`Then commit the updated docs/<pkg-slug>/*.api.md files.`);
    process.exit(1);
  }

  if (totalErrors > 0) {
    process.exit(1);
  }
}
