import { describe, test, expect } from 'bun:test';
import { generateConformance } from '../../../scripts/generate-conformance.mjs';

const manifest = {
  symbols: {
    Font: { members: ['bold'] },
    Body: { members: ['insertText', 'font'] },
    run: { isFunction: true, members: [] },
  },
};

const referenceFixture = {
  schemaVersion: 1,
  generatedFrom: { package: '@types/office-js', version: '1.0.0' },
  symbols: {
    Font: {
      uid: 'Word.Font',
      kind: 'class',
      requirementSet: 'WordApi 1.1',
      members: {
        bold: {
          uid: 'Word.Font#bold',
          kind: 'property',
          requirementSet: 'WordApi 1.1',
          overloads: [{ params: [], returns: 'boolean' }],
        },
      },
    },
    Body: {
      uid: 'Word.Body',
      kind: 'class',
      requirementSet: 'WordApi 1.1',
      members: {
        insertText: {
          uid: 'Word.Body#insertText',
          kind: 'method',
          requirementSet: 'WordApi 1.1',
          overloads: [
            {
              params: [
                { name: 'text', type: 'string' },
                { name: 'insertLocation', type: '"Replace" | "Start" | "End"' },
              ],
              returns: 'Range',
            },
          ],
        },
        font: {
          uid: 'Word.Body#font',
          kind: 'property',
          readonly: true,
          requirementSet: 'WordApi 1.1',
          overloads: [{ params: [], returns: 'Font' }],
        },
      },
    },
    run: {
      uid: 'Word.run',
      kind: 'function',
      requirementSet: null,
      overloads: [
        {
          params: [{ name: 'batch', type: '(context: RequestContext) => Promise<T>' }],
          returns: 'Promise<T>',
        },
      ],
    },
  },
};

const conformantSource = `
  export declare namespace DocxEditor {
    class Font {
      bold: boolean;
    }
    class Body {
      insertText(text: string, insertLocation: "Replace" | "Start" | "End"): Range;
      readonly font: Font;
    }
    function run<T>(batch: (context: RequestContext) => Promise<T>): Promise<T>;
  }
`;

const driftedSource = `
  export declare namespace DocxEditor {
    class Font {
      bold: boolean;
    }
    class Body {
      insertText(text: string, insertLocation: "Start" | "End"): Range;
    }
    function run<T>(batch: (context: RequestContext) => Promise<T>): Promise<T>;
  }
`;

describe('generateConformance', () => {
  test('reports zero issues for a fully conformant authored source', () => {
    const result = generateConformance({
      referenceFixture,
      manifest,
      docxEditorSourceText: conformantSource,
      docxEditorPackageVersion: '0.0.1',
    });
    expect(result.issues).toEqual([]);
  });

  test('reports a narrowed-overload issue when the authored source drifts from the reference', () => {
    const result = generateConformance({
      referenceFixture,
      manifest,
      docxEditorSourceText: driftedSource,
      docxEditorPackageVersion: '0.0.1',
    });
    expect(result.issues.some((i) => /Word\.Body#insertText/.test(i))).toBe(true);
  });

  test('pairs each reference overload with its true exact-match authored overload, not an arbitrary same-arity one (regression: Word.run)', () => {
    // `run` has two same-arity (2-param) reference overloads:
    // `(objects: ClientObject[], batch)` and `(object: ClientObject, batch)`.
    // A naive "first same-arity authored overload" pairing would compare
    // the array-typed reference overload against the singular-typed
    // authored overload and report a spurious mismatch even though an
    // exact match for *each* reference overload exists somewhere in the
    // authored list.
    const runManifest = { symbols: { run: { isFunction: true, members: [] } } };
    const runReference = {
      symbols: {
        run: {
          uid: 'Word.run',
          kind: 'function',
          overloads: [
            {
              params: [
                { name: 'objects', type: 'ClientObject[]' },
                { name: 'batch', type: '(context: RequestContext) => Promise<T>' },
              ],
              returns: 'Promise<T>',
            },
            {
              params: [
                { name: 'object', type: 'ClientObject' },
                { name: 'batch', type: '(context: RequestContext) => Promise<T>' },
              ],
              returns: 'Promise<T>',
            },
          ],
        },
      },
    };
    const runSource = `
      export declare namespace DocxEditor {
        function run<T>(object: ClientObject, batch: (context: RequestContext) => Promise<T>): Promise<T>;
        function run<T>(objects: ClientObject[], batch: (context: RequestContext) => Promise<T>): Promise<T>;
      }
    `;
    const result = generateConformance({
      referenceFixture: runReference,
      manifest: runManifest,
      docxEditorSourceText: runSource,
      docxEditorPackageVersion: '0.0.1',
    });
    expect(result.issues).toEqual([]);
    // The array-typed reference overload's `Ref_*`/`Auth_*` pair must both
    // be array-typed (proving it was paired with the array-typed authored
    // overload, not the singular one that happens to share its arity).
    const arrayRefLine = result.assertionsSource
      .split('\n')
      .find((line) => line.startsWith('type Ref_run_') && line.includes('ClientObject[]'));
    expect(arrayRefLine).toBeDefined();
    const pairIndex = arrayRefLine.match(/Ref_run_(\d+)/)[1];
    expect(result.assertionsSource).toContain(
      `type Auth_run_${pairIndex} = (objects: ClientObject[], batch: (context: RequestContext) => Promise<unknown>) => Promise<unknown>;`
    );
  });

  test('emits an extra readonly-sensitive object-type assertion pair for property members, in addition to the getter-shaped function assertion', () => {
    // `Word.Body#font` is `readonly` upstream (see `referenceFixture` above).
    // A bare `() => Font` function-type comparison cannot distinguish
    // `readonly font: Font` from a plain `font: Font` (readonly is not part
    // of a function type at all), so the generator must additionally emit
    // an object-type-literal pair — `{ readonly value: T }` vs `{ value: T }`
    // — which IS sensitive to the modifier under `IsExact`.
    const result = generateConformance({
      referenceFixture,
      manifest,
      docxEditorSourceText: conformantSource,
      docxEditorPackageVersion: '0.0.1',
    });
    expect(result.assertionsSource).toMatch(
      /type Ref_Body_font_readonly_\d+ = \{ readonly value: DocxEditor\.Font \};/
    );
    expect(result.assertionsSource).toMatch(
      /type Auth_Body_font_readonly_\d+ = \{ readonly value: DocxEditor\.Font \};/
    );
  });

  test('flags a dropped readonly modifier as a conformance issue even when the getter-shaped overload text is identical', () => {
    const readonlyDroppedSource = `
      export declare namespace DocxEditor {
        class Font {
          bold: boolean;
        }
        class Body {
          insertText(text: string, insertLocation: "Replace" | "Start" | "End"): Range;
          font: Font;
        }
        function run<T>(batch: (context: RequestContext) => Promise<T>): Promise<T>;
      }
    `;
    const result = generateConformance({
      referenceFixture,
      manifest,
      docxEditorSourceText: readonlyDroppedSource,
      docxEditorPackageVersion: '0.0.1',
    });
    expect(result.issues.some((i) => /Word\.Body#font/.test(i) && /readonly/i.test(i))).toBe(true);
  });

  test('the generator never emits a `Word.` qualifier inside a generated type alias (no upstream leakage into code, only into prose comments)', () => {
    const result = generateConformance({
      referenceFixture,
      manifest,
      docxEditorSourceText: conformantSource,
      docxEditorPackageVersion: '0.0.1',
    });
    const typeAliasLines = result.assertionsSource
      .split('\n')
      .filter((line) => line.trim().startsWith('type '));
    expect(typeAliasLines.length).toBeGreaterThan(0);
    for (const line of typeAliasLines) {
      expect(line).not.toMatch(/\bWord\./);
    }
  });
});
