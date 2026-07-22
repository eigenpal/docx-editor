import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DocxEditor } from '../src/driver/editor-driver';
import {
  docRange,
  getValidationErrors,
  loadVocabularyOracle,
  nonEmptyString,
  nonNegativeInteger,
  validateCommand,
  validateQuery,
} from '../src';

describe('DocxEditor vocabulary', () => {
  test('namespace is exclusively DocxEditor with no forbidden aliases', () => {
    const vocabulary = loadVocabularyOracle();
    expect(vocabulary.namespace).toBe('DocxEditor');
    expect(vocabulary.forbiddenAliases).toEqual([]);
  });

  test('toggleMark command validates bold and italic against JSON schema', () => {
    const bold: DocxEditor.Command = { type: 'toggleMark', mark: 'bold' };
    expect(validateCommand(bold)).toBe(true);
    const italic: DocxEditor.Command = { type: 'toggleMark', mark: 'italic' };
    expect(validateCommand(italic)).toBe(true);
    expect(getValidationErrors()).toEqual([]);
  });

  test('findText and selectedText queries validate', () => {
    const query: DocxEditor.Query = { type: 'findText', text: nonEmptyString('contract') };
    expect(validateQuery(query)).toBe(true);
    expect(validateQuery({ type: 'selectedText' })).toBe(true);
    expect(validateQuery({ type: 'selectionFormatting' })).toBe(true);
  });

  test('rejects alternate facade namespace shape', () => {
    expect(validateCommand({ type: 'toggleMark', mark: 'bold', namespace: 'Editor' })).toBe(false);
    expect(getValidationErrors().length).toBeGreaterThan(0);
    expect(validateCommand({ type: 'undo' })).toBe(false);
    expect(validateCommand({ type: 'redo' })).toBe(false);
    expect(validateCommand({ type: 'setSelection', range: {} })).toBe(false);
    expect(validateCommand({ type: 'toggleMark', mark: 'underline' as 'bold' })).toBe(false);
    expect(validateQuery({ type: 'findText', text: '' })).toBe(false);
    expect(getValidationErrors().length).toBeGreaterThan(0);
  });

  test('runtime-safe branded constructors align with schema constraints', () => {
    expect(String(nonEmptyString('body'))).toBe('body');
    expect(() => nonEmptyString('')).toThrow(/non-empty/);
    expect(Number(nonNegativeInteger(0))).toBe(0);
    expect(() => nonNegativeInteger(-1)).toThrow(/nonnegative/);
    expect(() => nonNegativeInteger(1.5)).toThrow(/nonnegative/);
    const range = docRange({ storyId: 'body', blockId: 'p1', start: 0, end: 1 });
    expect(String(range.storyId)).toBe('body');
    expect(String(range.blockId)).toBe('p1');
    expect(Number(range.start)).toBe(0);
    expect(Number(range.end)).toBe(1);
    expect(() => docRange({ storyId: '', blockId: 'p1', start: 0, end: 1 })).toThrow();
    expect(() => docRange({ storyId: 'body', blockId: 'p1', start: 2, end: 1 })).toThrow();
  });

  test('cross-adapter lifecycle scenario is frozen', () => {
    const vocabulary = loadVocabularyOracle();
    const scenario = vocabulary.crossAdapterLifecycleScenario;
    expect(scenario.id).toBe('lifecycle-bold-roundtrip-v1');
    expect(scenario.adapters).toEqual(['react', 'vue']);
    const actions = scenario.steps.map((s) => s.action);
    expect(actions).toContain('loadDocx');
    expect(actions).toContain('type');
    expect(actions).toContain('save');
    expect(
      scenario.steps.some((s) => s.action === 'execute' && s.command?.type === 'toggleMark')
    ).toBe(true);
  });
});

test('source and exports declare only the DocxEditor facade namespace', () => {
  const sourceRoot = join(import.meta.dir, '../src');
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (path.endsWith('.ts')) files.push(path);
    }
  };
  walk(sourceRoot);
  const source = files.map((path) => readFileSync(path, 'utf8')).join('\n');
  expect([...source.matchAll(/export\s+namespace\s+(\w+)/g)].map((match) => match[1])).toEqual([
    'DocxEditor',
  ]);
  expect(source).not.toMatch(/(?:namespace|type|const)\s+(?!DocxEditor\b)\w+\s*=\s*DocxEditor\b/);
});

describe('EditorDriver contract shape', () => {
  test('driver methods are engine-neutral (type-level compile check)', () => {
    const driverShape = [
      'loadDocx',
      'selectText',
      'type',
      'execute',
      'query',
      'undo',
      'save',
    ] as const satisfies readonly (keyof import('../src/driver/editor-driver').EditorDriver)[];
    expect(driverShape).toHaveLength(7);
  });
});
