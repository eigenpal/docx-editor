#!/usr/bin/env node
/**
 * Validates that all i18n locale files have the same key structure as en.json.
 *
 * Rules:
 * - Every key in en.json MUST exist in every locale file
 * - Missing keys should be set to null (untranslated, falls back to English)
 * - Extra keys not in en.json are flagged as errors
 *
 * Usage:
 *   node scripts/validate-i18n.mjs          # validate all locale files
 *   node scripts/validate-i18n.mjs --fix    # add missing keys as null, remove extra keys
 *
 * Exit codes:
 *   0 = all locale files are in sync
 *   1 = keys are out of sync (use --fix to auto-repair)
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const I18N_DIR = join(import.meta.dirname, '..', 'packages', 'react', 'i18n');
const EN_PATH = join(I18N_DIR, 'en.json');
const fix = process.argv.includes('--fix');

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

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
}

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
}

function deleteNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]] || typeof current[parts[i]] !== 'object') return;
    current = current[parts[i]];
  }
  delete current[parts[parts.length - 1]];
}

// Load English source of truth
const en = JSON.parse(readFileSync(EN_PATH, 'utf-8'));
const enPaths = getLeafPaths(en);

// Find all locale files except en.json
const localeFiles = readdirSync(I18N_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'en.json')
  .sort();

if (localeFiles.length === 0) {
  console.log('No community locale files found — nothing to validate.');
  process.exit(0);
}

let hasErrors = false;

for (const file of localeFiles) {
  const filePath = join(I18N_DIR, file);
  const locale = JSON.parse(readFileSync(filePath, 'utf-8'));
  const localePaths = getLeafPaths(locale);

  const missing = enPaths.filter((p) => !localePaths.includes(p));
  const extra = localePaths.filter((p) => !enPaths.includes(p));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`✓ ${file} — all ${enPaths.length} keys in sync`);
    continue;
  }

  if (fix) {
    // Add missing keys as null
    for (const path of missing) {
      setNestedValue(locale, path, null);
    }
    // Remove extra keys
    for (const path of extra) {
      deleteNestedValue(locale, path);
    }
    writeFileSync(filePath, JSON.stringify(locale, null, 2) + '\n', 'utf-8');
    console.log(
      `✓ ${file} — fixed: added ${missing.length} missing keys as null, removed ${extra.length} extra keys`
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
  console.error('\nRun `node scripts/validate-i18n.mjs --fix` to auto-repair locale files.');
  process.exit(1);
}
