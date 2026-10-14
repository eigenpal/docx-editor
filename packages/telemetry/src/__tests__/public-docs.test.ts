/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Every public name has documentation, and every function this package declares has an example,
// so an editor hover or an agent reading the types learns how to use it. The public names come
// from the API snapshots, which `api:check` keeps current.
import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const PACKAGE = path.resolve(import.meta.dir, '../..');
const ROOT = path.resolve(PACKAGE, '../..');
const SNAPSHOTS = path.join(ROOT, 'docs/api/docx-editor-telemetry');

function sources(dir: string): { file: string; text: string }[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter(
      (file) => /\.tsx?$/.test(file) && !file.includes('__tests__') && !file.endsWith('.d.ts')
    )
    .map((file) => ({
      file: path.join(dir, file),
      text: readFileSync(path.join(dir, file), 'utf8'),
    }));
}

const TELEMETRY = sources(path.join(PACKAGE, 'src'));
const CORE = sources(path.join(ROOT, 'packages/core/src'));

function publicNames(): { name: string; kind: string }[] {
  const names = new Map<string, string>();
  for (const file of readdirSync(SNAPSHOTS)) {
    const text = readFileSync(path.join(SNAPSHOTS, file), 'utf8');
    for (const match of text.matchAll(
      /^export (?:declare )?(function|const|interface|type|class) (\w+)/gm
    ))
      names.set(match[2]!, match[1]!);
  }
  return [...names].map(([name, kind]) => ({ name, kind }));
}

/** The comment right above a declaration of `name`, the package that declares it, or null. */
function declaration(name: string) {
  const pattern = new RegExp(
    `(\\/\\*\\*(?:(?!\\*\\/)[\\s\\S])*\\*\\/\\s*)?^export (?:async )?(?:function|const|interface|type|class) ${name}\\b`,
    'm'
  );
  for (const [where, files] of [
    ['telemetry', TELEMETRY],
    ['core', CORE],
  ] as const)
    for (const { text } of files) {
      const match = pattern.exec(text);
      if (match) return { where, doc: match[1] ?? '' };
    }
  return null;
}

test('every public name is documented, and every telemetry function has an example', () => {
  const names = publicNames();
  expect(names.length).toBeGreaterThan(50);
  const notFound: string[] = [];
  const undocumented: string[] = [];
  const noExample: string[] = [];
  for (const { name, kind } of names) {
    const found = declaration(name);
    if (!found) notFound.push(name);
    else if (!found.doc) undocumented.push(name);
    else if (kind === 'function' && found.where === 'telemetry' && !found.doc.includes('@example'))
      noExample.push(name);
  }
  expect({ notFound, undocumented, noExample }).toEqual({
    notFound: [],
    undocumented: [],
    noExample: [],
  });
});
