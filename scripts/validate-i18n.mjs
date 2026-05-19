#!/usr/bin/env node
/**
 * i18n CLI — manage locale files for the docx-editor.
 *
 * Commands:
 *   node scripts/validate-i18n.mjs validate        Check locale JSONs are in sync with en.json + typed exports are in sync with JSONs
 *   node scripts/validate-i18n.mjs validate --fix  Auto-repair: add missing keys as null, remove extras, regenerate typed exports
 *   node scripts/validate-i18n.mjs new <lang>      Scaffold a new locale file AND auto-wire it into the typed exports
 *   node scripts/validate-i18n.mjs status          Show translation coverage for all locales
 *   node scripts/validate-i18n.mjs codegen         Regenerate the typed exports in packages/i18n/src/index.ts from on-disk JSONs
 *
 * Shorthand (no subcommand = validate):
 *   node scripts/validate-i18n.mjs                 Same as `validate`
 *   node scripts/validate-i18n.mjs --fix           Same as `validate --fix`
 *
 * Exit codes:
 *   0 = success
 *   1 = validation error or bad usage
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { getLeafPaths } from './lib/i18n-keys.mjs';

// Locale files live in the shared @eigenpal/docx-editor-i18n package — both
// the React and Vue adapters read their defaults from here.
const I18N_DIR = join(import.meta.dirname, '..', 'packages', 'i18n');
const EN_PATH = join(I18N_DIR, 'en.json');

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (
      !(parts[i] in current) ||
      typeof current[parts[i]] !== 'object' ||
      current[parts[i]] === null
    ) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function deleteNestedValue(obj, path) {
  const parts = path.split('.');
  const stack = [obj];
  for (let i = 0; i < parts.length - 1; i++) {
    if (!stack[i][parts[i]] || typeof stack[i][parts[i]] !== 'object') return;
    stack.push(stack[i][parts[i]]);
  }
  delete stack[stack.length - 1][parts[parts.length - 1]];
  // Clean up empty parent objects
  for (let i = stack.length - 1; i > 0; i--) {
    if (Object.keys(stack[i]).length === 0) {
      delete stack[i - 1][parts[i - 1]];
    } else break;
  }
}

/** Build a skeleton object mirroring en.json structure with all leaves set to null */
function buildSkeleton(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      result[k] = buildSkeleton(v);
    } else {
      result[k] = null;
    }
  }
  return result;
}

// BCP-47 locale filename (e.g. `de.json`, `pt-BR.json`). The codegen and
// validate steps both ignore anything else next to the JSONs (package.json,
// tsconfig.json, future configs) so contributors can drop config files in
// without confusing the i18n tooling.
const BCP47_FILENAME = /^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*\.json$/;

function getLocaleFiles() {
  return readdirSync(I18N_DIR)
    .filter((f) => BCP47_FILENAME.test(f) && f !== 'en.json')
    .sort();
}

function pct(n, total) {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
}

// ---------------------------------------------------------------------------
// Codegen — rewrite the GENERATED block inside packages/i18n/src/index.ts
// from the on-disk locale JSON filenames. Called by `cmdNew` after creating
// a new JSON file; runs as its own `i18n:codegen` command; and `cmdValidate`
// errors if the on-disk block has drifted from the JSON filenames.
// ---------------------------------------------------------------------------

const INDEX_PATH = join(I18N_DIR, 'src', 'index.ts');
const GEN_START = '// ─── GENERATED START — `bun run i18n:codegen` ───';
const GEN_END = '// ─── GENERATED END ───';
const LANG_DISPLAY = new Intl.DisplayNames(['en'], { type: 'language' });

// `Intl.DisplayNames` output changes across Node / ICU versions (e.g. older
// runtimes emit `"Brazilian Portuguese"`, newer ones `"Portuguese (Brazil)"`),
// which would flip `i18n:validate` on CI vs. local. Pin the names the user
// actually sees in the JSDoc here. Keys are BCP-47 codes.
const LOCALE_NAME_OVERRIDES = {
  en: 'English',
  de: 'German',
  he: 'Hebrew',
  pl: 'Polish',
  'pt-BR': 'Portuguese (Brazil)',
  tr: 'Turkish',
  'zh-CN': 'Simplified Chinese',
};

function localeDisplayName(code) {
  return LOCALE_NAME_OVERRIDES[code] ?? LANG_DISPLAY.of(code) ?? code;
}

/** BCP-47 tag (e.g. `pt-BR`) → JS identifier (e.g. `ptBR`). */
function toIdentifier(code) {
  return code.replace(/-([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

/** Sort `en` first, then alphabetical by code. */
function sortLocales(codes) {
  return [...codes].sort((a, b) => (a === 'en' ? -1 : b === 'en' ? 1 : a.localeCompare(b)));
}

/** Read every `<code>.json` filename in `packages/i18n/`. Returns codes only. */
function readShippedLocales() {
  return readdirSync(I18N_DIR)
    .filter((f) => BCP47_FILENAME.test(f))
    .map((f) => f.replace(/\.json$/, ''));
}

function renderGeneratedBlock(codes) {
  const sorted = sortLocales(codes);
  const lines = [];

  lines.push(GEN_START);
  lines.push('// DO NOT EDIT — this block is rewritten from the on-disk');
  lines.push('// `packages/i18n/*.json` filenames whenever `bun run i18n:codegen`');
  lines.push('// runs (and `bun run i18n:new <lang>` runs it automatically).');
  lines.push('// `bun run i18n:validate` fails CI if hand-edits drift from the');
  lines.push('// JSON files. Edit the JSON, not this block.');
  lines.push('');
  for (const code of sorted) {
    lines.push(`import ${toIdentifier(code)}Json from '../${code}.json';`);
  }
  lines.push('');
  lines.push('/**');
  lines.push(' * Full locale string set, auto-derived from `en.json` (the source of truth).');
  lines.push(' * Every other locale is a `PartialLocaleStrings` against this shape.');
  lines.push(' *');
  lines.push(' * @public');
  lines.push(' */');
  lines.push('export type LocaleStrings = typeof enJson;');
  lines.push('');
  lines.push('/**');
  lines.push(' * Every locale code shipped from this package. Pass to `locales[code]`');
  lines.push(' * for runtime lookup; assign to `_lang` to drive `Intl.PluralRules`.');
  lines.push(' *');
  lines.push(' * Custom codes are accepted at runtime ({@link PartialLocaleStrings._lang}');
  lines.push(' * widens to any string), but the shipped union is the IDE-completion list.');
  lines.push(' *');
  lines.push(' * @public');
  lines.push(' */');
  lines.push(`export type LocaleCode = ${sorted.map((c) => `'${c}'`).join(' | ')};`);
  lines.push('');
  for (const code of sorted) {
    const id = toIdentifier(code);
    const name = localeDisplayName(code);
    if (code === 'en') {
      lines.push(`/** ${name} (\`en\`) — the source of truth, 100% covered. @public */`);
      lines.push(`export const en: LocaleStrings = enJson;`);
    } else {
      lines.push(
        `/** ${name} (\`${code}\`). Community-maintained; null leaves fall back to English. @public */`
      );
      lines.push(`export const ${id}: PartialLocaleStrings = ${id}Json;`);
    }
    lines.push('');
  }
  lines.push('/**');
  lines.push(' * Every shipped locale, keyed by BCP-47 tag. Use for runtime locale');
  lines.push(' * pickers and "look up the locale matching this user preference" code:');
  lines.push(' *');
  lines.push(' * ```ts');
  lines.push(' * <DocxEditor i18n={locales[userLocale]} />');
  lines.push(' * ```');
  lines.push(' *');
  lines.push(' * Importing `locales` defeats the per-locale tree-shake — the bundler');
  lines.push(' * sees a static reference to every locale. If you only need one or two,');
  lines.push(" * import them by name (`import { en, de } from '...'`) instead.");
  lines.push(' *');
  lines.push(' * @public');
  lines.push(' */');
  lines.push('export const locales: Record<LocaleCode, PartialLocaleStrings> = {');
  for (const code of sorted) {
    const id = toIdentifier(code);
    if (code === id) lines.push(`  ${id},`);
    else lines.push(`  '${code}': ${id},`);
  }
  lines.push('};');
  lines.push(GEN_END);

  return lines.join('\n');
}

/**
 * Locate the GENERATED block bounds in `src/index.ts`. Throws when either
 * marker is missing or when they appear out of order — the slice arithmetic
 * below would silently corrupt the file otherwise.
 */
function findSentinelBounds(src) {
  const startIdx = src.indexOf(GEN_START);
  const endIdx = src.indexOf(GEN_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Could not find codegen sentinels in ${INDEX_PATH}. Expected GENERATED START / END markers.`
    );
  }
  if (endIdx < startIdx) {
    throw new Error(
      `Codegen sentinels are out of order in ${INDEX_PATH}: END appears before START.`
    );
  }
  return { startIdx, endIdx };
}

/** Replace the GENERATED region of `src/index.ts` with the freshly-rendered block. */
function regenerateLocaleExports() {
  const src = readFileSync(INDEX_PATH, 'utf-8');
  const { startIdx, endIdx } = findSentinelBounds(src);
  const before = src.slice(0, startIdx);
  const after = src.slice(endIdx + GEN_END.length);
  const next = before + renderGeneratedBlock(readShippedLocales()) + after;
  if (next !== src) {
    writeFileSync(INDEX_PATH, next, 'utf-8');
    return true;
  }
  return false;
}

function cmdCodegen() {
  const changed = regenerateLocaleExports();
  if (changed) {
    console.log(`Rewrote packages/i18n/src/index.ts from ${readShippedLocales().length} locale files.`);
  } else {
    console.log('packages/i18n/src/index.ts already in sync with on-disk locales.');
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdValidate(fix) {
  const en = JSON.parse(readFileSync(EN_PATH, 'utf-8'));
  const enPaths = getLeafPaths(en);
  const localeFiles = getLocaleFiles();

  if (localeFiles.length === 0) {
    console.log('No community locale files found — nothing to validate.');
    return;
  }

  let hasErrors = false;

  for (const file of localeFiles) {
    const filePath = join(I18N_DIR, file);
    let locale;
    try {
      locale = JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch (e) {
      console.error(`✗ ${file}: invalid JSON — ${e.message}`);
      hasErrors = true;
      continue;
    }
    const localePaths = getLeafPaths(locale);

    const missing = enPaths.filter((p) => !localePaths.includes(p));
    const extra = localePaths.filter((p) => !enPaths.includes(p));

    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ ${file} — all ${enPaths.length} keys in sync`);
      continue;
    }

    if (fix) {
      for (const path of missing) setNestedValue(locale, path, null);
      for (const path of extra) deleteNestedValue(locale, path);
      writeFileSync(filePath, JSON.stringify(locale, null, 2) + '\n', 'utf-8');
      console.log(
        `✓ ${file} — fixed: added ${missing.length} missing keys as null, removed ${extra.length} extra keys`,
      );
    } else {
      hasErrors = true;
      console.error(`✗ ${file}:`);
      if (missing.length) {
        console.error(`  Missing ${missing.length} keys (should be null):`);
        for (const p of missing.slice(0, 10)) console.error(`    - ${p}`);
        if (missing.length > 10) console.error(`    ... and ${missing.length - 10} more`);
      }
      if (extra.length) {
        console.error(`  Extra ${extra.length} keys (not in en.json):`);
        for (const p of extra.slice(0, 10)) console.error(`    - ${p}`);
        if (extra.length > 10) console.error(`    ... and ${extra.length - 10} more`);
      }
    }
  }

  // Codegen sync check — `src/index.ts` must list every on-disk locale.
  // `i18n:new` keeps these aligned; this catches the case where a JSON file
  // was added by hand (or removed) without running the codegen.
  if (fix) {
    const changed = regenerateLocaleExports();
    if (changed) {
      console.log(`✓ src/index.ts — regenerated from ${readShippedLocales().length} locale files`);
    }
  } else {
    const current = readFileSync(INDEX_PATH, 'utf-8');
    const { startIdx, endIdx } = findSentinelBounds(current); // throws on missing / out-of-order markers
    const onDisk = current.slice(startIdx, endIdx + GEN_END.length);
    const expected = renderGeneratedBlock(readShippedLocales());
    if (onDisk !== expected) {
      hasErrors = true;
      console.error(
        '✗ src/index.ts — GENERATED block out of sync with on-disk locales. Run `bun run i18n:fix` (or `bun run i18n:codegen`) to regenerate.'
      );
    }
  }

  if (hasErrors) {
    console.error('\nRun `bun run i18n:fix` to auto-repair locale files.');
    process.exit(1);
  }
}

function cmdNew(lang) {
  if (!lang) {
    console.error('Usage: bun run i18n:new <lang>');
    console.error('Example: bun run i18n:new de');
    console.error('         bun run i18n:new pt-BR');
    process.exit(1);
  }

  // Validate lang tag (BCP 47: language, language-Script, language-Region, language-Script-Region)
  if (!/^[a-z]{2,3}(-[a-zA-Z0-9]{2,8})*$/.test(lang)) {
    console.error(
      `Invalid language tag: "${lang}". Use BCP 47 format (e.g., de, fr, pt-BR, zh-Hans, zh-Hant-TW).`,
    );
    process.exit(1);
  }

  const filePath = join(I18N_DIR, `${lang}.json`);
  if (existsSync(filePath)) {
    console.error(`${lang}.json already exists. To sync it, run: bun run i18n:fix`);
    process.exit(1);
  }

  const en = JSON.parse(readFileSync(EN_PATH, 'utf-8'));
  const skeleton = buildSkeleton(en);
  skeleton._lang = lang; // set language tag for plural rules
  const leafCount = getLeafPaths(en).length;

  writeFileSync(filePath, JSON.stringify(skeleton, null, 2) + '\n', 'utf-8');

  // Wire the new locale into the typed public surface — adds the import,
  // the typed `export const`, extends `LocaleCode`, and slots it into the
  // `locales` record. Contributors only edit the JSON.
  regenerateLocaleExports();

  console.log(`Created ${lang}.json with ${leafCount} keys (all set to null).`);
  console.log(`Wired \`${lang}\` into packages/i18n/src/index.ts.`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Open packages/i18n/${lang}.json`);
  console.log('  2. Replace null values with translations');
  console.log('     (partial is fine — null keys fall back to English)');
  console.log('  3. Run: bun run i18n:status');
  console.log('  4. Commit and open a PR!');
}

function cmdStatus() {
  const en = JSON.parse(readFileSync(EN_PATH, 'utf-8'));
  const enPaths = getLeafPaths(en);
  const total = enPaths.length;
  const localeFiles = getLocaleFiles();

  console.log(`Source: en.json (${total} keys)\n`);

  if (localeFiles.length === 0) {
    console.log('No community locale files yet.');
    console.log('Run `bun run i18n:new <lang>` to start a translation!');
    return;
  }

  // Table header
  const langCol = 12;
  const numCol = 12;
  console.log(
    'Locale'.padEnd(langCol) +
      'Translated'.padEnd(numCol) +
      'Untranslated'.padEnd(numCol) +
      'Coverage',
  );
  console.log('-'.repeat(langCol + numCol * 2 + 8));

  for (const file of localeFiles) {
    const lang = file.replace('.json', '');
    const filePath = join(I18N_DIR, file);
    const locale = JSON.parse(readFileSync(filePath, 'utf-8'));
    const localePaths = getLeafPaths(locale);

    let translated = 0;
    let untranslated = 0;
    for (const p of localePaths) {
      const parts = p.split('.');
      let val = locale;
      for (const part of parts) val = val?.[part];
      if (val === null) untranslated++;
      else translated++;
    }

    const outOfSync = enPaths.filter((p) => !localePaths.includes(p)).length;
    const coverage = pct(translated, total);
    const bar = makeBar(translated, total, 20);

    let line =
      lang.padEnd(langCol) +
      String(translated).padEnd(numCol) +
      String(untranslated + outOfSync).padEnd(numCol) +
      `${coverage} ${bar}`;
    if (outOfSync > 0) line += ` (${outOfSync} missing — run i18n:fix)`;

    console.log(line);
  }
}

function makeBar(filled, total, width) {
  const n = total > 0 ? Math.round((filled / total) * width) : 0;
  return '█'.repeat(n) + '░'.repeat(width - n);
}

// ---------------------------------------------------------------------------
// CLI Router
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('-')) || 'validate';
const flags = args.filter((a) => a.startsWith('-'));
const positionalArgs = args.filter((a) => !a.startsWith('-'));

switch (command) {
  case 'validate':
    cmdValidate(flags.includes('--fix'));
    break;
  case 'new': {
    const lang = positionalArgs[1]; // positionalArgs[0] is "new"
    cmdNew(lang);
    break;
  }
  case 'status':
    cmdStatus();
    break;
  case 'codegen':
    cmdCodegen();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Available: validate, new <lang>, status, codegen');
    process.exit(1);
}
