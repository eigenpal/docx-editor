// No parameter default may name a `let` or `const` that is declared later in an enclosing
// scope.
//
// The code is valid JavaScript, but apps rebuild the published packages with their own
// minifier. The Vite 8 minifier bound such defaults to an unrelated variable in 2.41.0:
// `deps = tableDeps` in `table-flow-pagination.ts` made every table that met a wrapping
// float fail with "Cannot read properties of undefined (reading 'lineMetrics')". Declare
// the binding first, or read it in the function body (`value ?? later`).

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const PACKAGES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') sourceFiles(path, out);
    } else if (
      /\.tsx?$/.test(name) &&
      !/\.(test|spec)\.tsx?$/.test(name) &&
      !name.endsWith('.d.ts')
    ) {
      out.push(path);
    }
  }
  return out;
}

function bindingNames(name: ts.BindingName, out: string[] = []): string[] {
  if (ts.isIdentifier(name)) out.push(name.text);
  else
    for (const element of name.elements)
      if (!ts.isOmittedExpression(element)) bindingNames(element.name, out);
  return out;
}

/** `file:line default → name` for each default that names a later block-scoped binding. */
function forwardParameterDefaults(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node) && node.initializer) {
      const owner = node.parent;
      const names = new Set<string>();
      const collect = (child: ts.Node): void => {
        if (
          ts.isIdentifier(child) &&
          !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child)
        )
          names.add(child.text);
        ts.forEachChild(child, collect);
      };
      collect(node.initializer);
      for (let scope: ts.Node | undefined = owner.parent; scope; scope = scope.parent) {
        if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
        for (const statement of scope.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          if (!(statement.declarationList.flags & ts.NodeFlags.BlockScoped)) continue;
          if (statement.getStart() <= owner.getStart()) continue;
          for (const declaration of statement.declarationList.declarations) {
            for (const name of bindingNames(declaration.name)) {
              if (!names.has(name)) continue;
              const { line } = source.getLineAndCharacterOfPosition(node.getStart());
              found.push(`${file}:${line + 1} ${node.getText()} → ${name}`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('parameter defaults', () => {
  test('detects a default that names a later const', () => {
    const text =
      'function f() {\n  const g = (x = later) => x;\n  const later = 1;\n  return g();\n}\n';
    expect(forwardParameterDefaults('fixture.ts', text)).toEqual([
      'fixture.ts:2 x = later → later',
    ]);
    expect(
      forwardParameterDefaults(
        'fixture.ts',
        'const early = 1;\nfunction f(x = early) { return x; }\n'
      )
    ).toEqual([]);
  });

  test('no package source names a later declaration in a parameter default', () => {
    const found: string[] = [];
    for (const pkg of readdirSync(PACKAGES)) {
      const src = join(PACKAGES, pkg, 'src');
      try {
        if (!statSync(src).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of sourceFiles(src)) {
        const rel = relative(PACKAGES, file).split(sep).join('/');
        found.push(...forwardParameterDefaults(rel, readFileSync(file, 'utf8')));
      }
    }
    expect(found).toEqual([]);
  });
});
