import { describe, test, expect } from 'bun:test';
import { extractDocxEditorShape } from '../../../scripts/lib/extract-docxeditor-shape.mjs';

const manifestSymbols = {
  Font: { members: ['bold', 'name'] },
  run: { isFunction: true, members: [] },
};

describe('extractDocxEditorShape', () => {
  test('extracts manifest-selected members from a `declare namespace DocxEditor` block', () => {
    const source = `
      export declare namespace DocxEditor {
        class Font {
          bold: boolean;
          readonly name: string;
          italic: boolean; // not manifest-selected, must not be extracted
        }
      }
    `;
    const result = extractDocxEditorShape(source, manifestSymbols);
    expect(Object.keys(result.Font.members).sort()).toEqual(['bold', 'name']);
    expect(result.Font.members.italic).toBeUndefined();
  });

  test('records DocxEditor-prefixed UIDs (never the upstream Word UID)', () => {
    const source = `
      export declare namespace DocxEditor {
        class Font {
          bold: boolean;
        }
      }
    `;
    const result = extractDocxEditorShape(source, manifestSymbols);
    expect(result.Font.uid).toBe('DocxEditor.Font');
    expect(result.Font.members.bold.uid).toBe('DocxEditor.Font#bold');
  });

  test('extracts a top-level function symbol (e.g. `run`) with its overloads', () => {
    const source = `
      export declare namespace DocxEditor {
        function run<T>(batch: (context: RequestContext) => Promise<T>): Promise<T>;
        function run<T>(object: ClientObject, batch: (context: RequestContext) => Promise<T>): Promise<T>;
      }
    `;
    const result = extractDocxEditorShape(source, manifestSymbols);
    expect(result.run.kind).toBe('function');
    expect(result.run.overloads).toHaveLength(2);
    expect(result.run.overloads[0]).toEqual({
      params: [{ name: 'batch', type: '(context: RequestContext) => Promise<T>' }],
      returns: 'Promise<T>',
    });
  });

  test('never extracts a symbol the manifest did not select', () => {
    const source = `
      export declare namespace DocxEditor {
        class Font { bold: boolean; }
        class UnselectedThing { value: string; }
      }
    `;
    const result = extractDocxEditorShape(source, manifestSymbols);
    expect(result.UnselectedThing).toBeUndefined();
  });

  test('ignores the manifest-recorded upstream `namespace` field: everything lives under one DocxEditor namespace', () => {
    // Unlike the upstream Word extractor, DocxEditor's own declarations are
    // repository-organized — there is no OfficeExtension/Word split to
    // mirror. A manifest entry's `namespace: "OfficeExtension"` (used only
    // to locate the symbol in Microsoft's source) must not be required here.
    const manifestWithUpstreamNamespaceHint = {
      ClientObject: { namespace: 'OfficeExtension', members: ['isNullObject'] },
    };
    const source = `
      export declare namespace DocxEditor {
        class ClientObject {
          isNullObject: boolean;
        }
      }
    `;
    const result = extractDocxEditorShape(source, manifestWithUpstreamNamespaceHint);
    expect(result.ClientObject.uid).toBe('DocxEditor.ClientObject');
    expect(result.ClientObject.members.isNullObject).toBeDefined();
  });

  test('canonicalizes single-quoted string literals to double quotes, matching the reference fixture\'s convention', () => {
    const source = `
      export declare namespace DocxEditor {
        class Font {
          selectionMode(): 'Select' | 'Start' | 'End';
        }
      }
    `;
    const result = extractDocxEditorShape(source, { Font: { members: ['selectionMode'] } });
    expect(result.Font.members.selectionMode.overloads[0].returns).toBe('"Select" | "Start" | "End"');
  });

  test('drops the spurious empty leading alternative from a Prettier-style leading-pipe multi-line union', () => {
    const source = `
      export declare namespace DocxEditor {
        class Font {
          readonly kind:
            | 'A'
            | 'B';
        }
      }
    `;
    const result = extractDocxEditorShape(source, { Font: { members: ['kind'] } });
    expect(result.Font.members.kind.overloads[0].returns).toBe('"A" | "B"');
  });

  test('strips a self-referential `DocxEditor.` qualifier from param/return type text', () => {
    const source = `
      export declare namespace DocxEditor {
        class Font {
          getOwner(): DocxEditor.Body;
        }
      }
    `;
    const result = extractDocxEditorShape(source, { Font: { members: ['getOwner'] } });
    expect(result.Font.members.getOwner.overloads[0].returns).toBe('Body');
  });
});
