/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import {
  findNode,
  projectOmmlEquation,
  readOoxmlPackage,
  serializeOoxmlPart,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';
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
const controlled =
  '<m:nary><m:naryPr><m:chr m:val="∑"/><m:ctrlPr><w:rPr><w:i/></w:rPr></m:ctrlPr></m:naryPr>' +
  '<m:sub/><m:sup/><m:e><m:f><m:fPr><m:ctrlPr><w:ins w:id="9" w:author="Public Author">' +
  '<w:rPr><w:i/></w:rPr></w:ins></m:ctrlPr></m:fPr><m:num><m:r><m:t>a</m:t></m:r></m:num>' +
  '<m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:e></m:nary>';
const besideLimits =
  '<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="subSup"/></m:naryPr>' +
  '<m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup>' +
  '<m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>';
const mathStyles =
  '<m:r><m:t>Q</m:t></m:r>' +
  '<m:r><m:rPr><m:sty m:val="bi"/></m:rPr><m:t>N</m:t></m:r>' +
  '<m:r><m:rPr><m:lit/><m:nor/></m:rPr><m:t>al</m:t></m:r>';

async function openPair(name: string, source: string) {
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
  // While paused, each side keeps its updates so two edits can be concurrent.
  let paused = false;
  const held: [Y.Doc, Uint8Array][] = [];
  const relay = (target: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (paused) held.push([target, update]);
    else Y.applyUpdate(target, update, 'relay');
  };
  const toRight = relay(rightDoc);
  const toLeft = relay(leftDoc);
  const pause = () => {
    paused = true;
  };
  const resume = () => {
    paused = false;
    for (const [target, update] of held.splice(0)) Y.applyUpdate(target, update, 'relay');
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
  const select = (editor: typeof left, offset: number) => {
    const surface = editor.surface!;
    const paragraphId = surface.session.paragraphIds()[0]!;
    surface.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
  };
  const close = () => {
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
  };
  return { left, right, equationXml, select, pause, resume, close };
}

for (const [name, source] of [
  ['formatted script', formatted],
  ['bar', barred],
  ['math styles', mathStyles],
  ['control properties', controlled],
  ['limits beside the operator', besideLimits],
] as const) {
  test(`two editors preserve ${name} through edits, undo, removal, and save`, async () => {
    const { left, right, equationXml, select, close } = await openPair(name, source);
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
      select(left, 4);
      const equation = left.surface!.equations.equationAtCaret()!;
      if (name === 'control properties' || name === 'limits beside the operator') {
        // The equation lays out as math, not as the text fallback, in both editors.
        for (const editor of [left, right]) {
          const part = editor.surface!.session.partFor({ kind: 'body' })!;
          const source = findNode(part, equation.id);
          expect(source && projectOmmlEquation(source)?.expression.kind).toBe('nary');
        }
        if (name === 'control properties') expect(original[0]!.match(/:ctrlPr>/g)).toHaveLength(4);
        else expect(original[0]).toMatch(/:limLoc \w+:val="subSup"\/>/);
      }
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
      close();
    }
  });
}

// Default control properties: the source app writes these on every structure.
const DEFAULT_CONTROL =
  '<m:ctrlPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/></w:rPr></m:ctrlPr>';
const defaultControlled =
  `<m:f><m:fPr>${DEFAULT_CONTROL}</m:fPr><m:num><m:r><m:t>a</m:t></m:r></m:num>` +
  `<m:den><m:sSup><m:sSupPr>${DEFAULT_CONTROL}</m:sSupPr><m:e><m:r><m:t>b</m:t></m:r></m:e>` +
  '<m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:den></m:f>';

test('two editors converge when one replaces an equation with default control properties', async () => {
  const { left, right, equationXml, select, pause, resume, close } = await openPair(
    'default control properties',
    defaultControlled
  );
  try {
    const original = equationXml(await left.save());
    select(left, 4);
    const equation = left.surface!.equations.equationAtCaret()!;
    expect(equation.linear).toBe('{a}/{b^{2}}');
    expect(left.surface!.equations.can(equation.id, 'replace')).toEqual({ ok: true });

    // Replace on the left while the right types beside the equation, then exchange updates.
    pause();
    expect(left.surface!.equations.applyEquation(equation.id, '{x}/{√{y}}+z^2')).toBe(true);
    select(right, 0);
    expect(right.exec({ type: 'pasteWithoutFormatting', text: 'Bob ' }).ok).toBe(true);
    resume();

    const replaced = equationXml(await left.save());
    expect(equationXml(await right.save())).toEqual(replaced);
    const control =
      /<m:ctrlPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"\/><w:i\/><\/w:rPr><\/m:ctrlPr>/;
    for (const property of ['fPr', 'radPr', 'sSupPr']) {
      expect(replaced[0]).toMatch(new RegExp(`<m:${property}>${control.source}</m:${property}>`));
    }
    expect(replaced[0]!.match(/<m:ctrlPr>/g)).toHaveLength(3);
    expect(left.surface!.session.bodyText()).toBe('Bob Left\uFFFCRight');
    expect(right.surface!.session.bodyText()).toBe('Bob Left\uFFFCRight');

    // `equationXml` reopens each saved package, so the control properties survive save.
    expect(replaced[0]).toContain('</m:ctrlPr></m:fPr>');

    // Undo restores the original source on both editors; redo reapplies the replacement.
    expect(left.exec({ type: 'undo' }).ok).toBe(true);
    expect(equationXml(await left.save())).toEqual(original);
    expect(equationXml(await right.save())).toEqual(original);
    expect(left.exec({ type: 'redo' }).ok).toBe(true);
    expect(equationXml(await left.save())).toEqual(replaced);
    expect(equationXml(await right.save())).toEqual(replaced);
  } finally {
    close();
  }
});

// Default run properties: the source app writes these on every run, often with a size.
const DEFAULT_RUN =
  '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/>' +
  '<w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>';
const defaultRuns =
  `<m:f><m:fPr>${DEFAULT_CONTROL}</m:fPr><m:num><m:r>${DEFAULT_RUN}<m:t>a</m:t></m:r></m:num>` +
  `<m:den><m:r>${DEFAULT_RUN}<m:t>b</m:t></m:r></m:den></m:f>`;

test('two editors converge when one replaces an equation with default run properties', async () => {
  const { left, right, equationXml, select, pause, resume, close } = await openPair(
    'default run properties',
    defaultRuns
  );
  try {
    const original = equationXml(await left.save());
    select(left, 4);
    const equation = left.surface!.equations.equationAtCaret()!;
    expect(equation.linear).toBe('{a}/{b}');
    expect(left.surface!.equations.can(equation.id, 'replace')).toEqual({ ok: true });

    // Replace on the left while the right types beside the equation, then exchange updates.
    pause();
    expect(left.surface!.equations.applyEquation(equation.id, '{x}/{√{y}}+z^2')).toBe(true);
    select(right, 0);
    expect(right.exec({ type: 'pasteWithoutFormatting', text: 'Bob ' }).ok).toBe(true);
    resume();

    const replaced = equationXml(await left.save());
    expect(equationXml(await right.save())).toEqual(replaced);
    // `equationXml` reopens each saved package, so every run keeps the default properties.
    const runs = replaced[0]!.match(/<m:r>.*?<\/m:r>/g)!;
    expect(runs.map((run) => /<m:t[ >]([^<]*)/.exec(run)![1])).toEqual(['x', 'y', '+', 'z', '2']);
    // The source serializes with its own math prefix; the run properties are the same.
    const savedRun = /<\w+:r>(<w:rPr>.*?<\/w:rPr>)/.exec(original[0]!)![1];
    expect(savedRun).toContain('<w:sz w:val="24"/>');
    for (const run of runs) expect(run.startsWith(`<m:r>${savedRun}<m:t`)).toBe(true);
    expect(replaced[0]!.match(/<m:ctrlPr>/g)).toHaveLength(3);
    expect(left.surface!.session.bodyText()).toBe('Bob Left￼Right');
    expect(right.surface!.session.bodyText()).toBe('Bob Left￼Right');

    // Undo restores the original source on both editors; redo reapplies the replacement.
    expect(left.exec({ type: 'undo' }).ok).toBe(true);
    expect(equationXml(await left.save())).toEqual(original);
    expect(equationXml(await right.save())).toEqual(original);
    expect(left.exec({ type: 'redo' }).ok).toBe(true);
    expect(equationXml(await left.save())).toEqual(replaced);
    expect(equationXml(await right.save())).toEqual(replaced);
  } finally {
    close();
  }
});

test('two editors keep an equation read-only when its default run properties differ', async () => {
  const sized = (size: string) =>
    '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/>' +
    `<w:sz w:val="${size}"/></w:rPr>`;
  const { left, right, equationXml, select, close } = await openPair(
    'different run sizes',
    `<m:r>${sized('24')}<m:t>a</m:t></m:r><m:r>${sized('28')}<m:t>b</m:t></m:r>`
  );
  try {
    const original = equationXml(await left.save());
    select(left, 4);
    const equation = left.surface!.equations.equationAtCaret()!;
    expect(left.surface!.equations.can(equation.id, 'replace').ok).toBe(false);
    expect(left.surface!.equations.applyEquation(equation.id, 'R')).toBe(false);
    expect(equationXml(await left.save())).toEqual(original);
    expect(equationXml(await right.save())).toEqual(original);
  } finally {
    close();
  }
});
