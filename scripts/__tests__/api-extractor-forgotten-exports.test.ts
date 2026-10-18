import { describe, expect, test } from 'bun:test';
import * as policy from '../lib/api-extractor-forgotten-exports.mjs';

describe('forgotten export policy', () => {
  test('accepts the reviewed internal/plumbing allowlist only', () => {
    expect(
      policy.evaluateForgottenExportPolicy({
        packageName: '@docx-editor.dev/editor-api',
        isLocal: false,
        allowlist: {
          index: ['RuntimeSession'],
          browser: ['RuntimeSession'],
        },
        messages: [
          'index: The symbol "RuntimeSession" needs to be exported by the entry point index.d.ts',
          'browser: The symbol "RuntimeSession" needs to be exported by the entry point browser.d.ts',
        ],
        protectedSymbols: ['DocumentCapabilities', 'Paragraph'],
      })
    ).toEqual({
      staleAllowlist: [],
      staleBaseline: [],
      unallowlisted: [],
      forbiddenAllowlist: [],
    });
  });

  test('fails a new forgotten export in both local and CI modes', () => {
    for (const isLocal of [true, false]) {
      expect(
        policy.evaluateForgottenExportPolicy({
          packageName: '@docx-editor.dev/editor-api',
          isLocal,
          allowlist: {
            index: ['RuntimeSession'],
            browser: ['RuntimeSession'],
          },
          messages: [
            'index: The symbol "RuntimeSession" needs to be exported by the entry point index.d.ts',
            'index: The symbol "LeakedNamespaceType" needs to be exported by the entry point index.d.ts',
          ],
          protectedSymbols: ['DocumentCapabilities', 'Paragraph'],
        }).unallowlisted
      ).toEqual([{ entry: 'index', symbol: 'LeakedNamespaceType' }]);
    }
  });

  test('fails stale allowlist entries once the warning disappears', () => {
    expect(
      policy.evaluateForgottenExportPolicy({
        packageName: '@docx-editor.dev/editor-api',
        isLocal: false,
        allowlist: {
          index: ['RuntimeSession', 'QueuedAction'],
        },
        messages: [
          'index: The symbol "RuntimeSession" needs to be exported by the entry point index.d.ts',
        ],
        protectedSymbols: ['DocumentCapabilities', 'Paragraph'],
      }).staleAllowlist
    ).toEqual([{ entry: 'index', symbol: 'QueuedAction' }]);
  });

  test('rejects allowlisting package-owned public symbols', () => {
    expect(
      policy.evaluateForgottenExportPolicy({
        packageName: '@docx-editor.dev/editor-api',
        isLocal: false,
        allowlist: {
          index: ['DocumentCapabilities', 'Paragraph'],
        },
        messages: [],
        protectedSymbols: ['DocumentCapabilities', 'Paragraph'],
      }).forbiddenAllowlist
    ).toEqual([
      { entry: 'index', symbol: 'DocumentCapabilities' },
      { entry: 'index', symbol: 'Paragraph' },
    ]);
  });

  test('accepts baselined warnings and reports baseline entries that stopped warning', () => {
    const result = policy.evaluateForgottenExportPolicy({
      packageName: '@docx-editor.dev/react',
      isLocal: false,
      allowlist: {},
      baseline: { index: ['MenuItem', 'FontFamilyTrigger'] },
      messages: [
        'index: The symbol "MenuItem" needs to be exported by the entry point index.d.ts',
        'index: The symbol "LeakedProps" needs to be exported by the entry point index.d.ts',
      ],
    });
    expect(result.unallowlisted).toEqual([{ entry: 'index', symbol: 'LeakedProps' }]);
    expect(result.staleBaseline).toEqual([{ entry: 'index', symbol: 'FontFamilyTrigger' }]);
    expect(result.staleAllowlist).toEqual([]);
  });

  test('normalizes only the bundler $N rename, and keeps real suffixes', () => {
    expect(
      policy.parseForgottenExportMessage(
        'index: The symbol "ToolbarButton$1" needs to be exported by the entry point index.d.ts'
      )
    ).toEqual({ entry: 'index', symbol: 'ToolbarButton' });
    expect(
      policy.parseForgottenExportMessage(
        'index: The symbol "Level_1" needs to be exported by the entry point index.d.ts'
      )
    ).toEqual({ entry: 'index', symbol: 'Level_1' });
  });

  test('a new Foo$1 cannot hide behind a baselined Foo', () => {
    const result = policy.evaluateForgottenExportPolicy({
      packageName: '@docx-editor.dev/react',
      isLocal: false,
      allowlist: {},
      baseline: { index: ['Foo'] },
      messages: [
        'index: The symbol "Foo" needs to be exported by the entry point index.d.ts',
        'index: The symbol "Foo$1" needs to be exported by the entry point index.d.ts',
      ],
    });
    expect(result.unallowlisted).toEqual([{ entry: 'index', symbol: 'Foo' }]);
    const both = policy.evaluateForgottenExportPolicy({
      packageName: '@docx-editor.dev/react',
      isLocal: false,
      allowlist: {},
      baseline: { index: ['Foo', 'Foo'] },
      messages: ['index: The symbol "Foo$1" needs to be exported by the entry point index.d.ts'],
    });
    expect(both.unallowlisted).toEqual([]);
    expect(both.staleBaseline).toEqual([{ entry: 'index', symbol: 'Foo' }]);
  });

  test('rejects baselining package-owned public symbols', () => {
    expect(
      policy.evaluateForgottenExportPolicy({
        packageName: '@docx-editor.dev/editor-api',
        isLocal: false,
        allowlist: {},
        baseline: { index: ['Paragraph'] },
        messages: [],
        protectedSymbols: ['Paragraph'],
      }).forbiddenAllowlist
    ).toEqual([{ entry: 'index', symbol: 'Paragraph' }]);
  });

  test('the next baseline drops stale entries and only records new ones on request', () => {
    const baseline = { index: ['Gone', 'Kept'], other: ['AlsoGone'] };
    const result = policy.evaluateForgottenExportPolicy({
      packageName: '@docx-editor.dev/core',
      isLocal: true,
      allowlist: {},
      baseline,
      messages: [
        'index: The symbol "Kept" needs to be exported by the entry point index.d.ts',
        'index: The symbol "Fresh" needs to be exported by the entry point index.d.ts',
      ],
    });
    expect(policy.nextForgottenExportBaseline({ baseline, policy: result })).toEqual({
      index: ['Kept'],
    });
    expect(policy.nextForgottenExportBaseline({ baseline, policy: result, record: true })).toEqual({
      index: ['Fresh', 'Kept'],
    });
  });

  test('a new Foo$1 cannot hide behind an allowlisted Foo', () => {
    const result = policy.evaluateForgottenExportPolicy({
      packageName: '@docx-editor.dev/pro',
      isLocal: false,
      allowlist: { index: ['Foo'] },
      messages: [
        'index: The symbol "Foo" needs to be exported by the entry point index.d.ts',
        'index: The symbol "Foo$1" needs to be exported by the entry point index.d.ts',
      ],
    });
    expect(result.unallowlisted).toEqual([{ entry: 'index', symbol: 'Foo' }]);
    expect(result.staleAllowlist).toEqual([]);
  });
});
