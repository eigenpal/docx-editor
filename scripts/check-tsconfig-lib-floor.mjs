#!/usr/bin/env node
/**
 * Guards the ES `lib` floor of every TypeScript program that contains core's SOURCE.
 *
 * The adapter and satellite packages map `@docx-editor.dev/core` (and its subpaths)
 * through tsconfig `paths` to `../core/src/*.ts` rather than to the built `.d.ts`, so
 * core's sources are part of those programs. That makes core's `lib` their floor:
 * core is ES2022 and its sources use ES2022 features (`Array.prototype.at`,
 * `Error.cause`), which a program on ES2020 cannot compile.
 *
 * This needs its own gate because the failure hides. An ambient `@types/*` package
 * that references a newer `lib` (`@types/bun` does, and it is installed here) puts
 * those globals in scope, so `bun run typecheck` and `bun run build:packages` can
 * both pass locally while a tree without that types package fails the dts build.
 *
 * If this fails, raise `target` and `lib` in the offending tsconfig to match core.
 * Do not rewrite the call sites: the floor is set by what core's source uses, so
 * patching one `.at(-1)` only defers the next break.
 */
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORE_SRC = join(repoRoot, 'packages', 'core', 'src');

/**
 * An ES level as a comparable number. `es5` → 5, `es6`/`es2015` → 2015,
 * `es2022` → 2022, `esnext` → Infinity. Numeric so a future `es2025` ranks
 * itself instead of needing a table entry.
 */
function esRank(name) {
  const n = String(name).toLowerCase();
  if (n === 'esnext') return Infinity;
  if (n === 'es6') return 2015;
  const m = /^es(\d+)$/.exec(n);
  return m ? Number(m[1]) : null;
}

/** Resolve a tsconfig the way tsc does, following `extends`. Null if unreadable. */
function parseConfig(configPath) {
  const host = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (!parsed) return null;
  // Missing `extends` targets (a generated `.nuxt/tsconfig.json`, say) make the
  // program meaningless rather than wrong. Skip instead of failing the gate.
  const fatal = parsed.errors.some((d) => d.code === 5083 || d.code === 6053);
  return fatal ? null : parsed;
}

/** The ES level of a program: the ES entry of `lib`, else `target`. */
function esLevelOf(parsed, label) {
  const libs = (parsed.options.lib ?? [])
    .map((l) => /^lib\.([a-z0-9]+)\.d\.ts$/.exec(l)?.[1])
    .filter((l) => l && esRank(l) !== null);
  if (libs.length > 1) throw new Error(`${label}: more than one ES level in "lib": ${libs.join(', ')}`);
  const name = libs[0] ?? ts.ScriptTarget[parsed.options.target ?? ts.ScriptTarget.ES5];
  const rank = esRank(name);
  if (rank === null) throw new Error(`${label}: cannot read an ES level from "lib"/"target"`);
  return { name: String(name).toUpperCase(), rank };
}

/** True when the config's `paths` point into `packages/core/src`. */
function mapsCoreSource(parsed, configPath) {
  const { paths, baseUrl } = parsed.options;
  if (!paths) return false;
  const base = baseUrl ?? dirname(configPath);
  return Object.values(paths).some((targets) =>
    targets.some((t) => {
      const abs = resolve(base, t);
      return abs === CORE_SRC || abs.startsWith(CORE_SRC + sep);
    })
  );
}

/** Every tsconfig worth checking: the root one, and one level down in each workspace. */
function candidates() {
  const found = [];
  if (existsSync(join(repoRoot, 'tsconfig.json'))) found.push(join(repoRoot, 'tsconfig.json'));
  for (const group of ['packages', 'examples']) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) continue;
    for (const pkg of readdirSync(groupDir, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      // core defines the floor; it cannot be below itself.
      if (group === 'packages' && pkg.name === 'core') continue;
      const pkgDir = join(groupDir, pkg.name);
      for (const entry of readdirSync(pkgDir)) {
        if (/^tsconfig(\..+)?\.json$/.test(entry)) found.push(join(pkgDir, entry));
      }
    }
  }
  return found;
}

const core = esLevelOf(parseConfig(join(repoRoot, 'packages', 'core', 'tsconfig.json')), 'packages/core');

const configs = [];
for (const configPath of candidates()) {
  const parsed = parseConfig(configPath);
  if (!parsed) continue;
  configs.push({ configPath, parsed, direct: mapsCoreSource(parsed, configPath) });
}

// A config that includes the sources of a package which itself maps core's source
// also compiles core. The root tsconfig reaches core this way: it includes
// `packages/react/src`, and react maps core to source.
const consumerSrcDirs = configs
  .filter((c) => c.direct)
  .map((c) => join(dirname(c.configPath), 'src'));

const failures = [];
for (const { configPath, parsed, direct } of configs) {
  const label = relative(repoRoot, configPath);
  const indirect =
    !direct &&
    parsed.fileNames.some((f) => consumerSrcDirs.some((d) => f.startsWith(d + sep)));
  if (!direct && !indirect) continue;

  const { name, rank } = esLevelOf(parsed, label);
  if (rank < core.rank) {
    failures.push(
      `${label} is ${name}, below core's ${core.name}. It compiles core's source ` +
        `${direct ? 'through "paths"' : 'by including a package that maps it'}, ` +
        `so it must be ${core.name} or higher.`
    );
  }
}

if (failures.length) {
  console.error(`✘ tsconfig lib floor violated (core is ${core.name}):\n`);
  console.error(failures.map((f) => `  ${f}`).join('\n'));
  console.error(`\nRaise "target" and "lib" in the offending tsconfig to match core.`);
  process.exit(1);
}
console.log(`✓ every tsconfig that compiles core's source is at or above ${core.name}.`);
