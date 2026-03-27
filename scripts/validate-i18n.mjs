#!/usr/bin/env node
/**
 * i18n CLI — manage locale files for the docx-editor.
 *
 * Commands:
 *   node scripts/validate-i18n.mjs validate       Check all locale files are in sync with en.json
 *   node scripts/validate-i18n.mjs validate --fix  Auto-repair: add missing keys as null, remove extras
 *   node scripts/validate-i18n.mjs new <lang>      Scaffold a new locale file (e.g., `new de`)
 *   node scripts/validate-i18n.mjs status          Show translation coverage for all locales
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

const I18N_DIR = join(import.meta.dirname, '..', 'packages', 'react', 'i18n');
const EN_PATH = join(I18N_DIR, 'en.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLeafPaths(obj, prefix = '') {
  const paths = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      paths.push(...getLeafPaths(v, path));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

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

function getLocaleFiles() {
  return readdirSync(I18N_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'en.json')
    .sort();
}

function pct(n, total) {
  if (total === 0) return '0%';
  return `${Math.round((n / total) * 100)}%`;
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
  const leafCount = getLeafPaths(en).length;

  writeFileSync(filePath, JSON.stringify(skeleton, null, 2) + '\n', 'utf-8');

  console.log(`Created ${lang}.json with ${leafCount} keys (all set to null).`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Open packages/react/i18n/${lang}.json`);
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
  default:
    console.error(`Unknown command: ${command}`);
    console.error('Available: validate, new <lang>, status');
    process.exit(1);
}
