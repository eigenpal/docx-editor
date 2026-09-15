import { createInterface } from 'node:readline/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, option, writeJSON } from './common.mjs';
import { validateRecord } from './policy.mjs';

export async function createChange() {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (name, prompt, fallback) =>
    option(name) ??
    (process.stdin.isTTY ? (await input.question(prompt + ': ')).trim() || fallback : fallback);
  try {
    const id = await ask('id', 'Short decision identifier');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id ?? ''))
      throw new Error('Provide --id <lowercase-slug>');
    const impact = await ask('impact', 'Impact (no-impact / compatible / migration-required)');
    const before = await ask('before', 'Previous behavior');
    const after = await ask('after', 'New behavior');
    const reason = await ask('reason', 'Why can released clients safely share rooms, or why not');
    const tests = (await ask('tests', 'Regression test paths, comma separated', ''))
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const fields =
      impact === 'migration-required'
        ? (await ask('fields', 'Changed version fields, comma separated', ''))
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
        : [];
    const migration =
      impact === 'migration-required'
        ? await ask('migration', 'Release-specific migration guide heading anchor')
        : null;
    const summary = await ask(
      'summary',
      'Consumer Changeset summary (leave empty for test/docs/CI-only changes)',
      ''
    );
    const record = {
      impact,
      fields,
      before,
      after,
      reason,
      tests,
      changeset: summary ? id : null,
      migration,
    };
    const path = `.collaboration/changes/${id}.json`;
    validateRecord(record, path);
    if (existsSync(resolve(ROOT, path)) || existsSync(resolve(ROOT, `.changeset/${id}.md`)))
      throw new Error('Identifier already exists');
    if (summary) {
      const note =
        impact === 'migration-required'
          ? `Breaking collaboration upgrade. ${summary} Export saved rooms with the previous compatible release, then reseed fresh rooms. See https://docx-editor.dev/pro/collaboration-versions#${migration}.`
          : summary;
      writeFileSync(
        resolve(ROOT, `.changeset/${id}.md`),
        `---\n'@docx-editor.dev/pro': ${impact === 'migration-required' ? 'minor' : 'patch'}\n---\n\n${note}\n`
      );
    }
    writeJSON(path, record);
    console.log(
      `Created ${path}. Review the decision, then run collaboration:check and collaboration:test.`
    );
  } finally {
    input.close();
  }
}
