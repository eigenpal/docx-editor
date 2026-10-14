/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { readOoxmlPackage, serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument, walk } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const formatted =
  '<m:sSubSup><m:e><m:r><m:rPr><m:nor/></m:rPr><w:rPr>' +
  '<w:rFonts w:ascii="Public Math" w:hAnsi="Public Math"/><w:b/>' +
  '</w:rPr><m:t>Q</m:t></m:r></m:e><m:sub><m:r><m:t>4</m:t></m:r></m:sub>' +
  '<m:sup><m:r><m:rPr><m:lit/></m:rPr><m:t>al</m:t></m:r></m:sup></m:sSubSup>';
const barred =
  '<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>' + '<m:e><m:r><m:t>N</m:t></m:r></m:e></m:bar>';
const mathStyles =
  '<m:r><m:t>Q</m:t></m:r>' +
  '<m:r><m:rPr><m:sty m:val="bi"/></m:rPr><m:t>N</m:t></m:r>' +
  '<m:r><m:rPr><m:lit/><m:nor/></m:rPr><m:t>al</m:t></m:r>';

for (const [name, source] of [
  ['formatted script', formatted],
  ['bar', barred],
  ['math styles', mathStyles],
] as const) {
  test(`two editors preserve ${name} through edits, undo, removal, and save`, async () => {
    const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
    const bytes = zipDocument(
      `<w:p xmlns:m="${M}"><w:r><w:t>Left</w:t></w:r>` +
        `<m:oMath>${source}</m:oMath><w:r><w:t>Right</w:t></w:r></w:p>`
    );
    const leftDoc = new Y.Doc();
    const rightDoc = new Y.Doc();
    const leftAwareness = new Awareness(leftDoc);
    const rightAwareness = new Awareness(rightDoc);
    const documentId = `equation-source-${name}`;
    const leftRoom = await createDocumentCollaboration({
      ydoc: leftDoc,
      awareness: leftAwareness,
      documentId,
      identity: { actorId: 'alice', name: 'Alice' },
      bootstrap: { kind: 'create', document: bytes },
    });
    Y.applyUpdate(rightDoc, Y.encodeStateAsUpdate(leftDoc), 'relay');
    const rightRoom = await createDocumentCollaboration({
      ydoc: rightDoc,
      awareness: rightAwareness,
      documentId,
      identity: { actorId: 'bob', name: 'Bob' },
      bootstrap: { kind: 'join', timeoutMs: 5000 },
    });
    const toRight = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'relay') Y.applyUpdate(rightDoc, update, 'relay');
    };
    const toLeft = (update: Uint8Array, origin: unknown) => {
      if (origin !== 'relay') Y.applyUpdate(leftDoc, update, 'relay');
    };
    leftDoc.on('update', toRight);
    rightDoc.on('update', toLeft);
    const leftContainer = document.createElement('div');
    const rightContainer = document.createElement('div');
    document.body.append(leftContainer, rightContainer);
    const left = createDocxEditor({
      container: leftContainer,
      document: leftRoom.document,
      modules: [collaborationModule({ session: leftRoom.session })],
    });
    const right = createDocxEditor({
      container: rightContainer,
      document: rightRoom.document,
      modules: [collaborationModule({ session: rightRoom.session })],
    });
    const equationXml = (saved: Uint8Array | ArrayBuffer): string[] => {
      const read = readOoxmlPackage(saved instanceof Uint8Array ? saved : new Uint8Array(saved));
      if (!read.ok) throw new Error(read.reason);
      const part = read.package.parts.get(read.package.mainDocumentPart)!;
      const equations: OoxmlNode[] = [];
      walk(part.root, (node) => {
        if (node.kind !== 'textValue' && node.namespaceUri === M && node.localName === 'oMath')
          equations.push(node);
      });
      return equations.map((node) => {
        if (node.kind === 'textValue') throw new Error('Expected equation element');
        return serializeOoxmlPart({ ...part, root: node });
      });
    };
    try {
      const original = equationXml(await left.save());
      expect(original).toHaveLength(1);
      if (name === 'math styles') {
        const saved = readOoxmlPackage(new Uint8Array(await left.save()));
        if (!saved.ok) throw new Error(saved.reason);
        const part = saved.package.parts.get(saved.package.mainDocumentPart)!;
        const texts: string[] = [];
        const styles: string[] = [];
        walk(part.root, (node) => {
          if (node.kind === 'textValue' || node.namespaceUri !== M) return;
          if (node.localName === 't') {
            texts.push(
              node.children.map((child) => (child.kind === 'textValue' ? child.value : '')).join('')
            );
          }
          if (node.localName === 'sty') {
            const value = node.attributes.find(
              (attribute) => attribute.namespaceUri === M && attribute.localName === 'val'
            );
            if (value) styles.push(value.value);
          }
        });
        expect(texts).toEqual(['Q', 'N', 'al']);
        expect(styles).toEqual(['bi']);
        expect(original[0]).not.toMatch(/[\u{1D400}-\u{1D7FF}]/u);
      }
      const select = (editor: typeof left, offset: number) => {
        const surface = editor.surface!;
        const paragraphId = surface.session.paragraphIds()[0]!;
        surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
      };
      select(left, 4);
      const equation = left.surface!.equations.equationAtCaret()!;
      expect(left.surface!.equations.applyEquation(equation.id, 'R')).toBe(false);
      expect(equationXml(await left.save())).toEqual(original);
      expect(equationXml(await right.save())).toEqual(original);
      select(left, 0);
      expect(left.exec({ type: 'pasteWithoutFormatting', text: 'Alice ' }).ok).toBe(true);
      select(right, 0);
      expect(right.exec({ type: 'pasteWithoutFormatting', text: 'Bob ' }).ok).toBe(true);
      expect(equationXml(await left.save())).toEqual(original);
      expect(equationXml(await right.save())).toEqual(original);
      expect(right.exec({ type: 'undo' }).ok).toBe(true);
      expect(right.exec({ type: 'redo' }).ok).toBe(true);
      const leftPart = readOoxmlPackage(new Uint8Array(await left.save()));
      const rightPart = readOoxmlPackage(new Uint8Array(await right.save()));
      if (!leftPart.ok || !rightPart.ok) throw new Error('Save and reopen failed');
      expect(
        serializeOoxmlPart(leftPart.package.parts.get(leftPart.package.mainDocumentPart)!)
      ).toEqual(
        serializeOoxmlPart(rightPart.package.parts.get(rightPart.package.mainDocumentPart)!)
      );
      expect(right.surface!.equations.removeEquation(equation.id)).toBe(true);
      expect(equationXml(await left.save())).toEqual([]);
      expect(equationXml(await right.save())).toEqual([]);
      expect(right.exec({ type: 'undo' }).ok).toBe(true);
      expect(equationXml(await left.save())).toEqual(original);
      expect(equationXml(await right.save())).toEqual(original);
    } finally {
      leftDoc.off('update', toRight);
      rightDoc.off('update', toLeft);
      left.destroy();
      right.destroy();
      leftContainer.remove();
      rightContainer.remove();
      leftRoom.destroy();
      rightRoom.destroy();
      leftAwareness.destroy();
      rightAwareness.destroy();
      leftDoc.destroy();
      rightDoc.destroy();
    }
  });
}
