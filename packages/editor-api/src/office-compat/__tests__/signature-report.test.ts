/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, expect, test } from 'bun:test';
import ts from 'typescript';
import {
  createCompatibilityReport as buildReport,
  extractActualInventory,
  renderDetails,
  renderAgentSummary,
} from '../../../scripts/compat-report.mjs';
import {
  extractUpstreamInventory,
  inventoryModule,
  normalizeSignatureText,
} from '../../../scripts/lib/signature-inventory.mjs';
import reference from '../../../compat/reference/word.full-inventory.json';
import notes from '../../../compat/runtime-notes.json';
import editingScope from '../../../compat/editing-scope.json';
import agentScope from '../../../compat/agent-editing-scope.json';

function createCompatibilityReport(
  reference,
  actual,
  notes = {},
  scope = {
    schemaVersion: 1,
    endpoints: reference.endpoints
      .filter(
        (entry) =>
          entry.uid.startsWith('Word.') &&
          entry.uid.includes('#') &&
          entry.scope === 'api' &&
          (entry.kind === 'method' || (entry.kind === 'property' && !entry.readonly))
      )
      .map((entry) => entry.uid),
  }
) {
  return buildReport(reference, actual, notes, scope);
}

const upstream = `
declare namespace OfficeExtension {
  class ClientObject { readonly context: string; }
}
declare namespace Word {
  class Range extends OfficeExtension.ClientObject {
    protected hidden: string;
    private secret: string;
    text: string;
    insert(value: string): Range;
    insert(value: number, ...options: string[]): Range;
    generic<T extends string = "a">(value?: T): Promise<T>;
  }
  enum Mode { first = "First", second = "Second" }
  function run(callback: (range: Range) => Promise<void>): Promise<void>;
  namespace Interfaces { interface RangeData { text?: string; } }
}
declare namespace Word { interface Merged { a: string; } }
declare namespace Word { interface Merged { b: number; } }
`;

function localInventory(source: string) {
  const name = '/actual.ts';
  const options = { strict: true, target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const original = host.getSourceFile;
  host.getSourceFile = (file, ...args) =>
    file === name
      ? ts.createSourceFile(name, source, options.target, true)
      : original(file, ...args);
  const program = ts.createProgram([name], options, host);
  const checker = program.getTypeChecker();
  return inventoryModule(
    checker,
    checker.getSymbolAtLocation(program.getSourceFile(name)!),
    'DocxEditor'
  );
}

describe('exhaustive signature inventory', () => {
  test('includes unselected APIs, inherited members, merged declarations, enums and nested support types', () => {
    const rows = extractUpstreamInventory(upstream);
    const ids = rows.map((row) => row.uid);
    for (const uid of [
      'Word.Range#context',
      'Word.Range#insert',
      'Word.Merged#a',
      'Word.Merged#b',
      'Word.Mode.first',
      'Word.Mode.second',
      'Word.run',
      'Word.Interfaces.RangeData#text',
    ]) {
      expect(ids).toContain(uid);
    }
    expect(ids).not.toContain('Word.Range#hidden');
    expect(ids).not.toContain('Word.Range#secret');
    expect(rows.find((row) => row.uid === 'Word.Interfaces.RangeData#text')?.scope).toBe(
      'supporting-types'
    );
    const method = rows.find((row) => row.uid === 'Word.Range#insert');
    expect(method.overloads).toHaveLength(2);
    expect(method.overloads[1].parameters[1].rest).toBe(true);
    expect(
      rows.find((row) => row.uid === 'Word.Range#generic').overloads[0].typeParameters
    ).toEqual([{ name: 'T', constraint: 'string', default: '"a"' }]);
  });

  test('normalizes union order and quote style without changing literals or dropping inline objects', () => {
    expect(normalizeSignatureText("Word.Range | 'a' | { value: string | number }")).toBe(
      normalizeSignatureText('{ value: number | string } | "a" | Range')
    );
    expect(normalizeSignatureText('"Word.Range"')).toBe('"Word.Range"');
    expect(normalizeSignatureText('"a b"')).not.toBe(normalizeSignatureText('"ab"'));
    expect(normalizeSignatureText('Range | { value: string }')).not.toBe(
      normalizeSignatureText('Range')
    );
  });

  test('keeps index and call signatures, predicates, this parameters and callable property modifiers', () => {
    const rows = localInventory(`export interface Callable {
      (this: { id: string }, value: unknown): value is string;
      readonly callback: (value: string) => number;
      [Symbol.iterator](): Iterator<string>;
    }
    export interface Dictionary { readonly [key: string]: number; }`);
    expect(rows.find((row) => row.uid === 'DocxEditor.Callable#call').overloads[0]).toMatchObject({
      thisType: '{ id : string ; }',
      predicate: { parameterIndex: 0, type: 'string' },
    });
    expect(rows.find((row) => row.uid === 'DocxEditor.Callable#callback')).toMatchObject({
      kind: 'property',
      readonly: true,
      writeType: null,
    });
    expect(rows.some((row) => row.uid === 'DocxEditor.Callable#[Symbol.iterator]')).toBe(true);
    expect(rows.find((row) => row.uid === 'DocxEditor.Dictionary#index:string')).toMatchObject({
      kind: 'index',
      readonly: true,
      type: 'number',
    });
  });

  test('retains generic alias constraints and namespace constant mutability', () => {
    const rows = localInventory(`export type Value<T extends string = "a"> = T;
      export const constant: string = "a";
      export let variable: string = "a";`);
    expect(rows.find((row) => row.uid === 'DocxEditor.Value').ownerTypeParameters).toEqual([
      { name: 'T', constraint: 'string', default: '"a"' },
    ]);
    expect(rows.find((row) => row.uid === 'DocxEditor.constant').readonly).toBe(true);
    expect(rows.find((row) => row.uid === 'DocxEditor.variable').readonly).toBe(false);
  });

  test('reads actual getters/setters, optionality, inherited exports and public constructors', () => {
    const rows = localInventory(`class Base { readonly id: string = ''; }
      class Range extends Base {
        private constructor() { super(); }
        get text(): string | null { return null; }
        set text(value: string) {}
        optional?: boolean;
        static create(): Range { return new Range(); }
      }
      export { Range };`);
    expect(rows.find((row) => row.uid === 'DocxEditor.Range#text')).toMatchObject({
      readonly: false,
      type: 'null | string',
      writeType: 'string',
    });
    expect(rows.find((row) => row.uid === 'DocxEditor.Range#optional')?.optional).toBe(true);
    expect(rows.map((row) => row.uid)).toContain('DocxEditor.Range#id');
    expect(rows.map((row) => row.uid)).toContain('DocxEditor.Range.create');
    expect(rows.map((row) => row.uid)).not.toContain('DocxEditor.Range#constructor');
  }, 30_000);
});

describe('informational report', () => {
  test('property writes ignore getter nullability but detect a refused or narrower setter', () => {
    const endpoints = extractUpstreamInventory(
      'declare namespace OfficeExtension {} declare namespace Word { class Font { bold: boolean; } }'
    );
    const fixture = { schemaVersion: 1, upstream: {}, endpoints };
    const actual = localInventory(
      'export class Font { get bold(): boolean | null { return null; } set bold(value: boolean) {} }'
    );
    const report = createCompatibilityReport(fixture, actual);
    expect(report.summary.percent).toBe(100);
    actual.find((row) => row.uid === 'DocxEditor.Font#bold').readonly = true;
    expect(createCompatibilityReport(fixture, actual).summary.percent).toBe(0);
  });

  test('object aliases expose editing members and inherited setters resolve generic arguments', () => {
    const alias = localInventory(
      'export type Range = { insert(value: string): Range; text: string };'
    );
    expect(alias.some((row) => row.uid === 'DocxEditor.Range#insert')).toBe(true);
    expect(alias.some((row) => row.uid === 'DocxEditor.Range#text')).toBe(true);
    const inherited = localInventory(
      'class Base<T> { get value(): T | null { return null; } set value(value: T) {} } export class Range extends Base<string> {}'
    );
    expect(inherited.find((row) => row.uid === 'DocxEditor.Range#value').writeType).toBe('string');
  });

  test('the editing scope excludes reads, navigation, infrastructure and option objects', () => {
    for (const uid of [
      'Word.run',
      'Word.Range#text',
      'Word.Range#getText',
      'Word.Range#select',
      'Word.Range#split',
      'Word.Paragraph#split',
      'Word.Selection#calculate',
      'Word.Range#load',
      'Word.Range#context',
      'Word.Range#isNullObject',
      'Word.SearchOptions#matchCase',
      'Word.Document#body',
    ]) {
      expect(editingScope.endpoints).not.toContain(uid);
    }
    expect(() =>
      buildReport(reference, [], {}, { schemaVersion: 1, endpoints: ['Word.run'] })
    ).toThrow('Not an editing');
    expect(() =>
      buildReport(reference, [], {}, { schemaVersion: 1, endpoints: ['Word.Missing#edit'] })
    ).toThrow('Unknown editing');
  });
  test('a removed overload, changed return or setter type lowers editing coverage', () => {
    const endpoints = extractUpstreamInventory(upstream);
    const fixture = { schemaVersion: 1, upstream: {}, endpoints };
    const actual = endpoints.map((row) => ({
      ...structuredClone(row),
      uid: row.uid.replace(/^(Word|OfficeExtension)\./, 'DocxEditor.'),
    }));
    expect(createCompatibilityReport(fixture, actual).summary.percent).toBe(100);
    actual.find((row) => row.uid === 'DocxEditor.Range#insert').overloads.pop();
    actual.find((row) => row.uid === 'DocxEditor.Range#generic').overloads[0].returns = 'number';
    actual.find((row) => row.uid === 'DocxEditor.Range#text').writeType = 'number';
    const report = createCompatibilityReport(fixture, actual);
    expect(report.summary.different).toBe(3);
    expect(report.summary.percent).toBeLessThan(100);
    expect(report.endpoints.find((row) => row.uid === 'Word.Range#insert').matchedOverloads).toBe(
      1
    );
  });

  test('runtime notes never promote signature coverage; stale notes fail clearly', () => {
    const fixture = {
      schemaVersion: 1,
      upstream: {},
      endpoints: extractUpstreamInventory(upstream),
    };
    const report = createCompatibilityReport(fixture, [], {
      'Word.Range#insert': { status: 'different', notes: 'Insertion differs.' },
    });
    expect(report.summary.percent).toBe(0);
    expect(report.summary.missing).toBe(report.summary.total);
    expect(report.endpoints.find((row) => row.uid === 'Word.Range#insert').runtime.status).toBe(
      'different'
    );
    expect(report.endpoints.find((row) => row.uid === 'Word.Range#text').runtime.status).toBe(
      'unverified'
    );
    expect(renderDetails(report)).toContain('Insertion differs.');
    expect(() =>
      createCompatibilityReport(fixture, [], { 'Word.typo': { status: 'partial', notes: 'Oops' } })
    ).toThrow('Unknown runtime note');
    expect(() => createCompatibilityReport({ ...fixture, endpoints: [] }, [])).toThrow(
      'Invalid signature inventory'
    );
  });

  test('the full pin measures actual exports, beyond the selected conformance fixture', () => {
    const actual = extractActualInventory();
    const report = createCompatibilityReport(reference, actual, notes, editingScope);
    expect(report.summary.total).toBe(editingScope.endpoints.length);
    expect(report.summary.total).toBe(
      report.summary.match + report.summary.different + report.summary.missing
    );
    // Support can grow or shrink without a coverage gate. Only the inventory is exhaustive.
    for (const uid of ['Word.Body#insertText', 'Word.Font#bold', 'Word.Table#addRows']) {
      expect(report.endpoints.some((row) => row.uid === uid)).toBe(true);
    }
    expect(JSON.stringify(actual)).not.toContain(process.cwd());
  }, 30_000);
});

test('the useful editing profile keeps its denominator and cannot turn signature matches into runtime claims', () => {
  const report = buildReport(reference, [], {}, agentScope);
  expect(report.summary.total).toBe(81);
  expect(report.summary.missing).toBe(81);
  const summary = renderAgentSummary(report, agentScope);
  expect(summary).toContain('0/81');
  expect(summary).toContain(
    'Neither member presence nor signature equality proves runtime equivalence'
  );
  expect(() =>
    renderAgentSummary(report, {
      ...agentScope,
      areas: { ...agentScope.areas, Duplicate: [agentScope.endpoints[0]] },
    })
  ).toThrow('exactly one area');
});
