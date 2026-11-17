/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// An ordinary table beside a body floating table (ECMA-376 Part 1, 17.4.57), and a table after a
// text frame (17.3.1.11), stand in the passage beside them. Two connected editors that type in
// the table beside the float and in the text after it, concurrently, delete text beside the float
// while the other side types in the table, and undo and redo, lay the page out exactly as a cold
// open of the saved document does.
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { readOoxmlPackage, serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { zipDocument } from './document-peer-support.ts';

let registeredDom = false;
beforeAll(() => {
  if (typeof document !== 'undefined') return;
  GlobalRegistrator.register();
  registeredDom = true;
});
afterAll(() => {
  if (registeredDom) GlobalRegistrator.unregister();
});

const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const words = (tag: string, count: number) =>
  Array.from({ length: count }, (_, index) => `${tag}${index}`).join(' ');
const float =
  '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="144" w:rightFromText="144" w:vertAnchor="text" ' +
  'w:horzAnchor="margin" w:tblpY="1"/><w:tblW w:w="4000" w:type="dxa"/></w:tblPr>' +
  '<w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="3000"/>' +
  `</w:trPr><w:tc>${p('Float cell')}</w:tc></w:tr></w:tbl>`;
const narrow = (text: string) =>
  '<w:tbl><w:tblPr><w:tblW w:w="2000" w:type="dxa"/><w:jc w:val="center"/></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc>${p(text)}</w:tc></w:tr></w:tbl>`;
const frame =
  '<w:p><w:pPr><w:framePr w:w="1500" w:wrap="around" w:vAnchor="text" w:hAnchor="text" w:y="1"/>' +
  '</w:pPr><w:r><w:t>Framed</w:t></w:r></w:p>';
const source =
  `${p('Lead')}${float}<w:p/>${narrow('Beside table')}${p(`After ${words('w', 40)}`)}` +
  `${frame}${narrow('Frame table')}${p('Tail')}`;
type Editor = Awaited<ReturnType<typeof openEditor>>;
async function openEditor(document: Uint8Array | object, modules?: unknown[]) {
  const { createDocxEditor } = await import('@docx-editor.dev/core/editor');
  const container = globalThis.document.createElement('div');
  globalThis.document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: document as Uint8Array,
    ...(modules ? { modules: modules as never } : {}),
  });
  return Object.assign(editor, { container });
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(editor: Editor): Promise<void> {
  while (!editor.surface) await tick();
  let last = '';
  for (let quiet = 0; quiet < 3;) {
    await tick();
    const state = editor.surface.state();
    const key = `${state.revision}:${state.pageCount}`;
    if (key !== last || editor.container.querySelector('[data-docx-layout-pending]')) {
      last = key;
      quiet = 0;
    } else quiet += 1;
  }
}

/** Page geometry without node ids: replicas and a reopened document mint their own ids. */
function geometry(editor: Editor): string {
  const lines: string[] = [];
  const visit = (fragment: Record<string, unknown>, depth: string) => {
    const box = fragment.box as { x: number; y: number; height: number };
    const floating = fragment.floatingWrap ? ' floating' : '';
    lines.push(
      `${depth}${String(fragment.kind)}${floating} ${box.x.toFixed(2)} ${box.y.toFixed(2)} ${box.height.toFixed(2)}`
    );
    for (const line of (fragment.lines ?? []) as {
      start: number;
      end: number;
      box: { x: number; width: number };
    }[])
      lines.push(
        `${depth}  ${line.start}-${line.end} ${line.box.x.toFixed(2)}+${line.box.width.toFixed(2)}`
      );
    for (const row of (fragment.rows ?? []) as {
      box: { y: number; height: number };
      cells: { blocks: Record<string, unknown>[] }[];
    }[]) {
      lines.push(`${depth}  row ${row.box.y.toFixed(2)} ${row.box.height.toFixed(2)}`);
      for (const c of row.cells) for (const block of c.blocks) visit(block, `${depth}    `);
    }
  };
  for (const page of editor.surface!.layout().pages) {
    lines.push(`page ${page.index}`);
    for (const fragment of page.fragments)
      visit(fragment as unknown as Record<string, unknown>, '  ');
  }
  return lines.join('\n');
}

/** The id of the paragraph whose text starts with `prefix`. */
function paragraphId(editor: Editor, prefix: string): string {
  let found: string | undefined;
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
  const walk = (node: OoxmlNode) => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && textOf(node).startsWith(prefix)) found = node.id;
    else for (const child of node.children) walk(child);
  };
  walk(editor.surface!.session.part().root);
  if (!found) throw new Error(`no paragraph starts with ${prefix}`);
  return found;
}

function typeAt(editor: Editor, prefix: string, text: string): void {
  const id = paragraphId(editor, prefix);
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset: 0 },
    head: { paragraphId: id, offset: 0 },
  });
  editor.surface!.type(text);
}

function deleteAt(editor: Editor, prefix: string, from: number, to: number): void {
  const id = paragraphId(editor, prefix);
  editor.surface!.setSelection({
    anchor: { paragraphId: id, offset: from },
    head: { paragraphId: id, offset: to },
  });
  expect(editor.surface!.deleteSelection()).toBe(true);
}

/** The table that holds `prefix` stands right of the floating table, on the same rows. */
function expectBeside(editor: Editor, prefix: string): void {
  const id = paragraphId(editor, prefix);
  const fragments = editor.surface!.layout().pages[0]!.fragments;
  const floating = fragments.find((f) => f.kind === 'table' && f.floatingWrap)!;
  const holder = fragments.find(
    (f) =>
      f.kind === 'table' &&
      !f.floatingWrap &&
      f.rows.some((row) =>
        row.cells.some((cell) =>
          cell.blocks.some((block) => block.kind === 'paragraph' && block.paragraphId === id)
        )
      )
  )!;
  expect(holder.box.x).toBeGreaterThanOrEqual(floating.box.x + floating.box.width);
  expect(holder.box.y).toBeLessThan(floating.box.y + floating.box.height);
}

function xmlOf(saved: Uint8Array | ArrayBuffer): string {
  const read = readOoxmlPackage(saved instanceof Uint8Array ? saved : new Uint8Array(saved));
  if (!read.ok) throw new Error(read.reason);
  return serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
}

test('two editors editing a table beside a float lay out as a cold open', async () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const aa = new Awareness(a);
  const ba = new Awareness(b);
  const leftRoom = await createDocumentCollaboration({
    ydoc: a,
    awareness: aa,
    documentId: 'table-beside-float',
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: zipDocument(source) },
  });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'relay');
  const rightRoom = await createDocumentCollaboration({
    ydoc: b,
    awareness: ba,
    documentId: 'table-beside-float',
    identity: { actorId: 'bob', name: 'Bob' },
    bootstrap: { kind: 'join', timeoutMs: 5000 },
  });
  let paused = false;
  const toA: Uint8Array[] = [];
  const toB: Uint8Array[] = [];
  const relayA = (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (paused) toB.push(update);
    else Y.applyUpdate(b, update, 'relay');
  };
  const relayB = (update: Uint8Array, origin: unknown) => {
    if (origin === 'relay') return;
    if (paused) toA.push(update);
    else Y.applyUpdate(a, update, 'relay');
  };
  a.on('update', relayA);
  b.on('update', relayB);
  const left = await openEditor(leftRoom.document, [
    collaborationModule({ session: leftRoom.session }),
  ]);
  const right = await openEditor(rightRoom.document, [
    collaborationModule({ session: rightRoom.session }),
  ]);
  const opened: Editor[] = [left, right];
  const flush = () => {
    paused = false;
    for (const update of toA.splice(0)) Y.applyUpdate(a, update, 'relay');
    for (const update of toB.splice(0)) Y.applyUpdate(b, update, 'relay');
  };
  const expectColdLayout = async () => {
    await settle(left);
    await settle(right);
    const saved = new Uint8Array(await left.save());
    expect(xmlOf(await right.save())).toBe(xmlOf(saved));
    const cold = await openEditor(saved);
    opened.push(cold);
    await settle(cold);
    expect(geometry(left)).toBe(geometry(cold));
    expect(geometry(right)).toBe(geometry(cold));
  };
  try {
    await settle(left);
    await settle(right);
    expectBeside(left, 'Beside table');
    expectBeside(right, 'Beside table');
    // In the table beside the float and in the text after it at once.
    paused = true;
    typeAt(left, 'After', 'Wrapped ');
    typeAt(right, 'Beside table', 'Edited ');
    flush();
    await expectColdLayout();
    const typed = xmlOf(await left.save());
    for (const text of ['Wrapped After', 'Edited Beside table']) expect(typed).toContain(text);
    expectBeside(left, 'Edited Beside table');
    // One side deletes the text beside the float while the other types in the table.
    paused = true;
    deleteAt(left, 'Wrapped', 0, 'Wrapped After w0 w1 w2 '.length);
    typeAt(right, 'Frame table', 'More ');
    flush();
    await expectColdLayout();
    expect(right.exec({ type: 'undo' }).ok).toBe(true);
    await expectColdLayout();
    expect(right.exec({ type: 'redo' }).ok).toBe(true);
    await expectColdLayout();
    expectBeside(right, 'Edited Beside table');
  } finally {
    a.off('update', relayA);
    b.off('update', relayB);
    for (const editor of opened) {
      editor.destroy();
      editor.container.remove();
    }
    leftRoom.destroy();
    rightRoom.destroy();
    aa.destroy();
    ba.destroy();
    a.destroy();
    b.destroy();
  }
});
