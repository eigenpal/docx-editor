/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Every public object-model member that the pinned Office.js reference does not declare carries
 * the `@docxEditorExtension` TSDoc tag, and no tagged member is one Office.js declares. Editors
 * show the tag on hover and agents read it from the declarations, so code that must also run in
 * an Office.js host can tell which members will not.
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import fullInventory from '../../../compat/reference/word.full-inventory.json';

const TAG = '@docxEditorExtension';
const modelDir = path.join(__dirname, '..', '..', 'model');

interface ClassInfo {
  readonly exported: boolean;
  readonly base: string | undefined;
  /** Public member name to whether its doc comment carries the tag. */
  readonly members: Map<string, boolean>;
}

function docOf(node: ts.Node, source: ts.SourceFile): string {
  return (ts.getJSDocCommentsAndTags(node) as readonly ts.Node[])
    .map((doc) => doc.getText(source))
    .join('\n');
}

function isPublicMember(member: ts.ClassElement, source: ts.SourceFile): boolean {
  if (!member.name || !ts.isIdentifier(member.name)) return false;
  const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
  if (
    modifiers.some(
      (modifier) =>
        modifier.kind === ts.SyntaxKind.PrivateKeyword ||
        modifier.kind === ts.SyntaxKind.ProtectedKeyword ||
        modifier.kind === ts.SyntaxKind.StaticKeyword
    )
  )
    return false;
  if (ts.isConstructorDeclaration(member)) return false;
  return !docOf(member, source).includes('@internal');
}

function modelClasses(): Map<string, ClassInfo> {
  const classes = new Map<string, ClassInfo>();
  for (const file of fs.readdirSync(modelDir).filter((name) => name.endsWith('.ts'))) {
    const text = fs.readFileSync(path.join(modelDir, file), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isClassDeclaration(statement) || !statement.name) continue;
      const exported = (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
      );
      const heritage = statement.heritageClauses?.find(
        (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
      );
      const baseExpression = heritage?.types[0]?.expression;
      const members = new Map<string, boolean>();
      for (const member of statement.members) {
        if (!isPublicMember(member, source)) continue;
        const name = (member.name as ts.Identifier).text;
        const tagged = docOf(member, source).includes(TAG);
        members.set(name, (members.get(name) ?? false) || tagged);
      }
      classes.set(statement.name.text, {
        exported,
        base: baseExpression && ts.isIdentifier(baseExpression) ? baseExpression.text : undefined,
        members,
      });
    }
  }
  return classes;
}

describe('the @docxEditorExtension tag', () => {
  const upstream = new Set(fullInventory.endpoints.map((entry) => entry.uid));
  const upstreamClasses = new Set([...upstream].map((uid) => uid.split('#')[0]));
  const classes = modelClasses();

  // Members a class has from model classes it extends, with the class that declares them.
  function membersOf(name: string): Map<string, boolean> {
    const own = classes.get(name);
    if (!own) return new Map();
    const inherited = own.base ? membersOf(own.base) : new Map<string, boolean>();
    return new Map([...inherited, ...own.members]);
  }

  const checked = [...classes]
    .filter(([name, info]) => info.exported && upstreamClasses.has(`Word.${name}`))
    .flatMap(([name]) =>
      [...membersOf(name)].map(([member, tagged]) => ({
        uid: `Word.${name}#${member}`,
        tagged,
      }))
    );

  test('finds the object model classes', () => {
    expect(checked.length).toBeGreaterThan(200);
  });

  test('marks every member the pinned Office.js reference does not declare', () => {
    const untagged = checked
      .filter((entry) => !upstream.has(entry.uid) && !entry.tagged)
      .map((entry) => entry.uid);
    expect(untagged).toEqual([]);
  });

  test('marks no member the pinned Office.js reference declares', () => {
    const wrong = checked
      .filter((entry) => upstream.has(entry.uid) && entry.tagged)
      .map((entry) => entry.uid);
    expect(wrong).toEqual([]);
  });

  test('marks the review item functions, which have no Office.js counterpart', () => {
    const text = fs.readFileSync(path.join(modelDir, 'review-items.ts'), 'utf8');
    for (const name of [
      'getReviewItemRevisions',
      'getReviewItemRange',
      'getReviewItemRangeOrNullObject',
    ]) {
      const declaration = text.indexOf(`export function ${name}(`);
      const doc = text.slice(text.lastIndexOf('/**', declaration), declaration);
      expect(doc).toContain(TAG);
    }
  });
});
