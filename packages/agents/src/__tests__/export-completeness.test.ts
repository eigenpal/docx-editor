// Can a consumer NAME what this package hands them?
//
// `entry-surface.test.ts` next door asks what the entries export. This one asks the harder
// question, and asks it against the barrels rather than against a list written here: the object
// model's public vocabulary is `model/index.ts`, the lifecycle's is `runtime/public.ts`, and an
// entry that re-exports one of them minus a few names produces a surface where
// `body.contentControls` hands back a `ContentControlCollection` the consumer cannot import in
// order to write the signature down. That compiles, ships, and only fails the person using it.
//
// A hand-written list of expected names would need editing every time the model grows, which is
// exactly the edit that gets forgotten — so both halves are derived: the source of truth for
// "public" is the barrel, and the source of truth for "referenced" is the committed API report.

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { collectNamedExports } from '../../../../scripts/lib/named-exports.mjs';
import * as browser from '../browser.ts';
import * as root from '../index.ts';

const SRC = join(import.meta.dir, '..');

const namesIn = (...segments: string[]): ReadonlySet<string> =>
  collectNamedExports(join(SRC, ...segments));

const modelBarrel = namesIn('model', 'index.ts');
const lifecycleBarrel = namesIn('runtime', 'public.ts');
const rootEntry = namesIn('index.ts');
const browserEntry = namesIn('browser.ts');

/** Sorted, so a failure reads as the missing names rather than as two shuffled sets. */
const missing = (expected: ReadonlySet<string>, actual: ReadonlySet<string>): string[] =>
  [...expected].filter((name) => !actual.has(name)).sort();

describe('the barrels the entries are built from', () => {
  test('the model barrel is non-trivial, so satisfying it means something', () => {
    // Without this, emptying `model/index.ts` would turn every assertion below green.
    expect(modelBarrel.size).toBeGreaterThan(30);
    for (const known of ['Body', 'Paragraph', 'ContentControlCollection', 'PageSetup']) {
      expect(modelBarrel.has(known)).toBe(true);
    }
  });

  test('the lifecycle barrel re-exports the whole model barrel', () => {
    expect(missing(modelBarrel, lifecycleBarrel)).toEqual([]);
  });

  test('and names the lifecycle itself, capabilities included', () => {
    for (const name of [
      'RequestContext',
      'TrackedObjects',
      'ClientObject',
      'ClientResult',
      'DocxEditorError',
      'DocxEditorRuntime',
      'DocxEditorServerRuntime',
      'DocumentCapabilities',
      'DocumentLimits',
      'ParagraphAlignment',
      'RunCallback',
      'CreateServerOptions',
    ]) {
      expect(lifecycleBarrel.has(name)).toBe(true);
    }
  });
});

describe('both published entries', () => {
  test.each([
    ['the root entry', (): ReadonlySet<string> => rootEntry],
    ['the browser entry', (): ReadonlySet<string> => browserEntry],
  ])('%s carries every name the barrels declare public', (_label, entry) => {
    expect(missing(lifecycleBarrel, entry())).toEqual([]);
    expect(missing(modelBarrel, entry())).toEqual([]);
  });

  test('the two agree on everything but the namespace, at the source level too', () => {
    const withoutNamespace = (names: ReadonlySet<string>): string[] =>
      [...names].filter((name) => name !== 'DocxEditor').sort();
    expect(withoutNamespace(browserEntry)).toEqual(withoutNamespace(rootEntry));
  });

  test.each([
    ['the root entry', (): Record<string, unknown> => root as Record<string, unknown>],
    ['the browser entry', (): Record<string, unknown> => browser as Record<string, unknown>],
  ])('%s exports the model classes as values, not only as types', (_label, entry) => {
    // A class re-exported with `export type` would satisfy the source-level checks above and
    // still fail `instanceof` for a consumer. The classes are the barrel's names that the loaded
    // module answers a function for; every one of them has to be on both entries.
    const module = entry();
    const loaded = root as unknown as Record<string, unknown>;
    const classes = [...modelBarrel].filter((name) => typeof loaded[name] === 'function');
    expect(classes.length).toBeGreaterThan(20);
    expect(classes.filter((name) => typeof module[name] !== 'function')).toEqual([]);
  });
});
