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
});
