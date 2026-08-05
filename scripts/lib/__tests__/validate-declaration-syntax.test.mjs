import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  declarationHasImplementationBody,
  findUnresolvedDeclarationImports,
  validateDeclarationSyntax,
} from '../validate-declaration-syntax.mjs';

describe('validate-declaration-syntax', () => {
  test('detects function bodies in declare signatures', () => {
    const bad = `export declare function foo(x: number): number {
  if (!x) return 0;
  return x + 1;
}`;
    expect(declarationHasImplementationBody(bad)).toBe(true);
    const good = 'export declare function foo(x: number): number;';
    expect(declarationHasImplementationBody(good)).toBe(false);
  });

  test('tsc rejects declare function implementation bodies', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'docx-dts-bad-'));
    const file = path.join(dir, 'bad.d.ts');
    writeFileSync(
      file,
      `export declare function toolbarCommandState(editor: unknown): { enabled: boolean } {
  if (!editor) return { enabled: false };
  return { enabled: true };
};`
    );
    const errors = validateDeclarationSyntax(file);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join('\n')).toMatch(/implementation|Statements are not allowed|TS1183|TS1036/);
  });

  test('resolves .js specifiers to sibling .d.ts (TypeScript ESM)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'docx-dts-js-spec-'));
    writeFileSync(path.join(dir, 'agent-types-hash.d.ts'), 'export type AgentHash = string;\n');
    const nested = path.join(dir, 'nested');
    mkdirSync(nested);
    writeFileSync(
      path.join(nested, 'consumer.d.ts'),
      "export type { AgentHash } from '../agent-types-hash.js';\n"
    );
    expect(findUnresolvedDeclarationImports(dir)).toEqual([]);
  });

  test('reports unresolved relative declaration imports', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'docx-dts-imports-'));
    writeFileSync(path.join(dir, 'index.d.ts'), "export type { X } from './missing';\n");
    const errors = findUnresolvedDeclarationImports(dir);
    expect(errors).toEqual(["index.d.ts: unresolved declaration import './missing'"]);
  });
});
