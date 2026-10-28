/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { caretAt, linesOf, type EquationGeometry } from '@docx-editor.dev/core/layout';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, walk, zipDocument, type Peer } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('equation-authored-run-fonts', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

function mount(peer: Peer): Editor {
  peer.detach();
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: peer.room.document,
    modules: [collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return editor;
}

function textFaces(node: EquationGeometry): unknown[] {
  if (node.kind === 'row') return node.items.flatMap(textFaces);
  if (node.kind !== 'text') throw new Error('Unexpected equation geometry');
  return [[node.text, node.runStyle?.fontFamily, node.runStyle?.bold, node.runStyle?.italic]];
}

function snapshot(editor: Editor) {
  const layout = editor.surface!.layout();
  const equation = linesOf(layout)
    .flatMap((line) => line.spans)
    .find((span) => span.equation)!;
  expect(textFaces(equation.equation!.geometry)).toEqual([
    ['𝑥', 'Cambria Math', false, false],
    ['12', 'Arial', true, true],
    ['+𝛼', 'Cambria Math', false, false],
    ['normal', 'Paragraph Face', false, false],
  ]);
  const before = caretAt(layout, {
    paragraphId: equation.range.paragraphId,
    offset: equation.range.start,
  })!;
  const after = caretAt(layout, {
    paragraphId: equation.range.paragraphId,
    offset: equation.range.end,
  })!;
  expect(after.x - before.x).toBeCloseTo(equation.equation!.geometry.box.width, 5);
  expect(after.height).toBeGreaterThan(0);
  return {
    faces: textFaces(equation.equation!.geometry),
    width: equation.equation!.geometry.box.width,
  };
}

function equationXml(editor: Editor): string[] {
  const part = editor.surface!.session.partFor({ kind: 'body' })!;
  const equations: string[] = [];
  walk(part.root, (node) => {
    if (
      node.kind !== 'textValue' &&
      node.namespaceUri === 'http://schemas.openxmlformats.org/officeDocument/2006/math' &&
      node.localName === 'oMath'
    )
      equations.push(serializeOoxmlPart({ ...part, root: node }));
  });
  return equations;
}

function select(editor: Editor, offset: number) {
  const paragraphId = editor.surface!.session.paragraphIds()[0]!;
  editor.surface!.setSelection({ anchor: { paragraphId, offset }, head: { paragraphId, offset } });
}

test('two editors preserve equation fonts, atomic carets, history, and concurrent deletion', async () => {
  const peers = await harness.pair(
    zipDocument(
      '<w:p xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">' +
        '<w:r><w:t>Left</w:t></w:r><m:oMath>' +
        '<m:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/></w:rPr><m:t>x12+α</m:t></m:r>' +
        '<m:r><m:rPr><m:nor/></m:rPr><m:t>normal</m:t></m:r></m:oMath>' +
        '<w:r><w:t>Right</w:t></w:r></w:p>',
      {
        overrides:
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
        documentRels:
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        extraXml: {
          'word/styles.xml':
            '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Paragraph Face" w:hAnsi="Paragraph Face"/></w:rPr></w:style></w:styles>',
        },
      }
    )
  );
  const alice = mount(peers.alice);
  const bob = mount(peers.bob);
  const original = equationXml(alice);
  const sync = () => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
  };
  const converged = () => {
    sync();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  };
  expect(snapshot(bob)).toEqual(snapshot(alice));
  select(alice, 5);
  applyAwarenessUpdate(
    peers.bob.awareness,
    encodeAwarenessUpdate(peers.alice.awareness, [peers.alice.ydoc.clientID]),
    'test'
  );
  const remote = peers.bob.room.session.remoteSelections()[0]!;
  expect(remote.head.offset).toBe(5);
  const local = alice.surface!.state().selection.head;
  const localCaret = caretAt(alice.surface!.layout(), local)!;
  const remoteCaret = caretAt(bob.surface!.layout(), {
    paragraphId: remote.head.nodeId!,
    offset: remote.head.offset,
  })!;
  expect({ x: remoteCaret.x, y: remoteCaret.y, height: remoteCaret.height }).toEqual({
    x: localCaret.x,
    y: localCaret.y,
    height: localCaret.height,
  });

  peers.pause();
  select(alice, 0);
  alice.surface!.type('Alice ');
  select(bob, 0);
  bob.surface!.type('Bob ');
  sync();
  peers.resume();
  converged();
  expect(equationXml(alice)).toEqual(original);
  expect(snapshot(bob)).toEqual(snapshot(alice));
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(alice.exec({ type: 'redo' }).ok).toBe(true);
  converged();
  expect(snapshot(bob)).toEqual(snapshot(alice));

  const offset = alice.surface!.session.bodyText().indexOf('\uFFFC');
  select(alice, offset);
  const equation = alice.surface!.equations.equationAtCaret()!;
  peers.pause();
  expect(alice.surface!.equations.removeEquation(equation.id)).toBe(true);
  select(bob, 0);
  bob.surface!.type('Concurrent ');
  sync();
  peers.resume();
  converged();
  expect(equationXml(alice)).toEqual([]);
  expect(equationXml(bob)).toEqual([]);
  expect(alice.findMatches('Concurrent')).toHaveLength(1);
  expect(alice.exec({ type: 'undo' }).ok).toBe(true);
  converged();
  expect(equationXml(alice)).toEqual(original);
  expect(snapshot(bob)).toEqual(snapshot(alice));
  const late = await harness.join(peers.alice, 'late-peer');
  const lateEditor = mount(late);
  expect(snapshot(lateEditor)).toEqual(snapshot(alice));
  expect(saveReopenDigest(lateEditor.surface!.session.currentPackage())).toEqual(
    saveReopenDigest(alice.surface!.session.currentPackage())
  );
});
