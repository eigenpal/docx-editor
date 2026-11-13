/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Every public endpoint that the pinned Office.js reference does not declare carries the
 * `@docxEditorExtension` TSDoc tag, and no tagged endpoint is one Office.js declares.
 *
 * The check walks what the package entry points really export, with the TypeScript checker, so
 * inherited members, functions, enums, and members added later are all covered. Editors show the
 * tag on hover and agents read it from the declarations, so code that must also run in an
 * Office.js host can tell which calls will not.
 */
import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import ts from 'typescript';
import fullInventory from '../../../compat/reference/word.full-inventory.json';

const TAG = 'docxEditorExtension';
const packageDir = path.join(__dirname, '..', '..', '..');
const ENTRIES = ['src/index.ts', 'src/browser.ts', 'src/agent.ts'];

/** Members every Office.js client object has, which the inventory does not list per class. */
const CLIENT_OBJECT_MEMBERS = new Set([
  'context',
  'isNullObject',
  'load',
  'set',
  'toJSON',
  'track',
  'untrack',
]);

/**
 * Exports with no Office.js counterpart that are not part of the document model: host setup,
 * errors, and agent helpers. AGENTS.md keeps these separate from the Office-shaped model, so they
 * are not tagged. Each entry names its Office.js analog or says it has none.
 */
const INFRASTRUCTURE: Readonly<Record<string, string>> = {
  ClientObject: 'OfficeExtension.ClientObject',
  ClientResult: 'OfficeExtension.ClientResult',
  TrackedObjects: 'OfficeExtension.TrackedObjects',
  DocxEditorError: 'OfficeExtension.Error',
  isDocxEditorError: 'error type guard; no Office.js analog',
  DocxEditor: 'runtime namespace, the analog of the Word global',
  RewriteError: 'agent helper error; no Office.js analog',
  prepareRewrite: 'agent helper; no Office.js analog',
};

const upstream = new Set(fullInventory.endpoints.map((entry) => entry.uid));
const upstreamClasses = new Set(
  fullInventory.endpoints.filter((entry) => entry.uid.includes('#')).map((e) => e.uid.split('#')[0])
);
const upstreamEnums = new Set(
  fullInventory.endpoints
    .filter((entry) => entry.kind === 'enum-member')
    .map((entry) => entry.uid.slice(0, entry.uid.lastIndexOf('.')))
);

function tagged(symbol: ts.Symbol): boolean {
  return symbol.getJsDocTags().some((tag) => tag.name === TAG);
}

function internalOrHidden(symbol: ts.Symbol): boolean {
  if (symbol.getName().startsWith('#') || symbol.getName().startsWith('__')) return true;
  if (symbol.getJsDocTags().some((tag) => tag.name === 'internal')) return true;
  return (symbol.declarations ?? []).some((declaration) => {
    const flags = ts.getCombinedModifierFlags(declaration as ts.Declaration);
    return (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0;
  });
}

interface Endpoint {
  readonly uid: string;
  readonly tagged: boolean;
  /** Whether the pinned Office.js reference declares it. */
  readonly upstream: boolean;
}

function endpoints(): { readonly checked: Endpoint[]; readonly unclassified: string[] } {
  const config = ts.readConfigFile(path.join(packageDir, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageDir);
  const files = ENTRIES.map((entry) => path.join(packageDir, entry));
  const program = ts.createProgram(files, parsed.options);
  const checker = program.getTypeChecker();
  const checked = new Map<string, Endpoint>();
  const unclassified = new Set<string>();
  const add = (uid: string, symbol: ts.Symbol) =>
    checked.set(uid, { uid, tagged: tagged(symbol), upstream: upstream.has(uid) });

  for (const file of files) {
    const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(file)!)!;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const name = symbol.getName();
      const word = `Word.${name}`;
      if (symbol.flags & ts.SymbolFlags.Enum) {
        if (!upstreamEnums.has(word)) {
          if (!tagged(symbol)) unclassified.add(name);
          continue;
        }
        for (const member of checker.getExportsOfModule(symbol))
          add(`${word}.${member.getName()}`, member);
        continue;
      }
      const isClass = (symbol.flags & ts.SymbolFlags.Class) !== 0;
      const isInterface = (symbol.flags & ts.SymbolFlags.Interface) !== 0;
      if ((isClass || isInterface) && upstreamClasses.has(word)) {
        const type = checker.getDeclaredTypeOfSymbol(symbol);
        for (const member of checker.getPropertiesOfType(type)) {
          if (internalOrHidden(member) || CLIENT_OBJECT_MEMBERS.has(member.getName())) continue;
          add(`${word}#${member.getName()}`, member);
        }
        continue;
      }
      // Types and interfaces with no Office.js counterpart describe the values that tagged
      // members take and return; the member carries the tag.
      if ((symbol.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface)) !== 0) continue;
      if (Object.hasOwn(INFRASTRUCTURE, name)) continue;
      if (!tagged(symbol)) unclassified.add(name);
    }
  }
  return { checked: [...checked.values()], unclassified: [...unclassified].sort() };
}

describe('the @docxEditorExtension tag', () => {
  const { checked, unclassified } = endpoints();

  test('finds the Office-shaped endpoints', () => {
    expect(checked.length).toBeGreaterThan(400);
  });

  test('marks every member and enum value the pinned Office.js reference does not declare', () => {
    expect(checked.filter((entry) => !entry.upstream && !entry.tagged).map((e) => e.uid)).toEqual(
      []
    );
  });

  test('marks no member or enum value the pinned Office.js reference declares', () => {
    expect(checked.filter((entry) => entry.upstream && entry.tagged).map((e) => e.uid)).toEqual([]);
  });

  test('tags or lists as infrastructure every export with no Office.js counterpart', () => {
    expect(unclassified).toEqual([]);
  });
});
