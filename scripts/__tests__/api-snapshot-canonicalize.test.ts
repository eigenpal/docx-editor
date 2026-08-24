import { describe, expect, test } from 'bun:test';
import { canonicalizeApiReport } from '../lib/api-snapshot-canonicalize.mjs';

function report(body: string): string {
  return ['## API Report File', '', '```ts', body, '```', ''].join('\n');
}

describe('canonicalizeApiReport', () => {
  test('two reports differing only in inferred member order canonicalize identically', () => {
    const orderA = report(
      [
        'export const DocxEditorRoot: vue.DefineComponent<vue.ExtractPropTypes<{',
        '    zoomMode: {',
        '        type: PropType<ZoomMode | "auto">;',
        '        default: undefined;',
        '    };',
        '    tableInteractionLabel: {',
        '        type: PropType<DocxEditorRootProps["tableInteractionLabel"]>;',
        '        default: undefined;',
        '    };',
        '    imageDecodePort: {',
        '        type: PropType<ImageDecodePort>;',
        '        default: undefined;',
        '    };',
        '}>>;',
      ].join('\n')
    );
    const orderB = report(
      [
        'export const DocxEditorRoot: vue.DefineComponent<vue.ExtractPropTypes<{',
        '    tableInteractionLabel: {',
        '        type: PropType<DocxEditorRootProps["tableInteractionLabel"]>;',
        '        default: undefined;',
        '    };',
        '    imageDecodePort: {',
        '        type: PropType<ImageDecodePort>;',
        '        default: undefined;',
        '    };',
        '    zoomMode: {',
        '        type: PropType<ZoomMode | "auto">;',
        '        default: undefined;',
        '    };',
        '}>>;',
      ].join('\n')
    );
    expect(orderA).not.toBe(orderB);
    expect(canonicalizeApiReport(orderA)).toBe(canonicalizeApiReport(orderB));
  });

  test('sorts property signatures alphabetically and recursively', () => {
    const input = report(
      ['export const x: {', '    b: {', '        d: 1;', '        c: 2;', '    };', '    a: 3;', '};'].join(
        '\n'
      )
    );
    expect(canonicalizeApiReport(input)).toBe(
      report(
        ['export const x: {', '    a: 3;', '    b: {', '        c: 2;', '        d: 1;', '    };', '};'].join(
          '\n'
        )
      )
    );
  });

  test('is idempotent', () => {
    const input = report(
      ['export const x: {', '    b: string;', '    a: number;', '};'].join('\n')
    );
    const once = canonicalizeApiReport(input);
    expect(canonicalizeApiReport(once)).toBe(once);
  });

  test('leaves declaration bodies with report comments untouched', () => {
    const input = report(
      [
        'export interface Props {',
        '    // (undocumented)',
        '    zoom?: number;',
        '    // (undocumented)',
        '    author?: string;',
        '}',
      ].join('\n')
    );
    expect(canonicalizeApiReport(input)).toBe(input);
  });

  test('leaves call signatures, methods, and index signatures untouched', () => {
    const overloads = report(
      [
        'export const x: {',
        '    (a: string): number;',
        '    (a: number): string;',
        '};',
      ].join('\n')
    );
    expect(canonicalizeApiReport(overloads)).toBe(overloads);

    const methods = report(
      ['export const x: {', '    save(): void;', '    load(): void;', '};'].join('\n')
    );
    expect(canonicalizeApiReport(methods)).toBe(methods);

    const indexed = report(
      ['export const x: {', '    [key: string]: any;', '    a: 1;', '};'].join('\n')
    );
    expect(canonicalizeApiReport(indexed)).toBe(indexed);
  });

  test('does not reorder unions, tuples, or parameter lists', () => {
    const input = report(
      [
        "export type U = 'b' | 'a';",
        'export type T = [b: string, a: number];',
        'export function f(b: string, a: number): void;',
      ].join('\n')
    );
    expect(canonicalizeApiReport(input)).toBe(input);
  });

  test('handles quoted member names and braces inside string literals', () => {
    const input = report(
      [
        'export const x: {',
        "    'z-key': string;",
        '    "a.key": \'{\';',
        '};',
      ].join('\n')
    );
    expect(canonicalizeApiReport(input)).toBe(
      report(
        [
          'export const x: {',
          '    "a.key": \'{\';',
          "    'z-key': string;",
          '};',
        ].join('\n')
      )
    );
  });

  test('leaves markdown outside the ts fence untouched', () => {
    const input = ['# Title {not: code; other: thing;}', '', '```ts', 'export const a: 1;', '```', ''].join(
      '\n'
    );
    expect(canonicalizeApiReport(input)).toBe(input);
  });
});
