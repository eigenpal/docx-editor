/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Typing in a table with vertically merged cells re-places only the edited row when its height
// holds. Two connected editors that type beside merges, concurrently and through undo and
// redo, lay the table out exactly as a cold open of the saved document does.
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

const SPAN = 4;
const cell = (text: string, merge = '') =>
  `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${merge}</w:tcPr>` +
  (text ? `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>` : '<w:p/>') +
  '</w:tc>';
const rows = Array.from({ length: 80 }, (_, index) => {
  const first =
    index % SPAN === 0
      ? cell(`Head ${index}`, '<w:vMerge w:val="restart"/>')
      : cell('', '<w:vMerge/>');
  return `<w:tr>${first}${cell(`Row ${index}`)}</w:tr>`;
}).join('');
const source =
  '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
  `${rows}</w:tbl><w:p/>`;

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
    const box = fragment.box as { y: number; height: number };
    lines.push(`${depth}${String(fragment.kind)} ${box.y.toFixed(2)} ${box.height.toFixed(2)}`);
    for (const line of (fragment.lines ?? []) as { start: number; end: number }[])
      lines.push(`${depth}  ${line.start}-${line.end}`);
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

/** The paragraph id of `row`'s cell `column` (every cell holds one paragraph). */
function cellParagraph(editor: Editor, row: number, column: number): string {
  const ids: string[] = [];
  const walk = (node: OoxmlNode, inCell: boolean) => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && inCell) ids.push(node.id);
    for (const child of node.children) walk(child, inCell || node.kind === 'tableCell');
  };
  walk(editor.surface!.session.part().root, false);
  return ids[row * 2 + column]!;
}

function typeAt(editor: Editor, row: number, column: number, text: string): void {
  const paragraphId = cellParagraph(editor, row, column);
  editor.surface!.setSelection({
    anchor: { paragraphId, offset: 0 },
    head: { paragraphId, offset: 0 },
  });
  editor.surface!.type(text);
}

function xmlOf(saved: Uint8Array | ArrayBuffer): string {
  const read = readOoxmlPackage(saved instanceof Uint8Array ? saved : new Uint8Array(saved));
  if (!read.ok) throw new Error(read.reason);
  return serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
}

test('two editors typing beside merged cells lay out as a cold open', async () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const aa = new Awareness(a);
  const ba = new Awareness(b);
  const leftRoom = await createDocumentCollaboration({
    ydoc: a,
    awareness: aa,
    documentId: 'merged-cell-typing',
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: zipDocument(source) },
  });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'relay');
  const rightRoom = await createDocumentCollaboration({
    ydoc: b,
    awareness: ba,
    documentId: 'merged-cell-typing',
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
    // Beside a head and beside a continuation, while the other side types in a head.
    paused = true;
    typeAt(left, 8, 1, 'A');
    typeAt(left, 9, 1, 'B');
    typeAt(right, 12, 0, 'C');
    typeAt(right, 13, 1, 'D');
    paused = false;
    for (const update of toA.splice(0)) Y.applyUpdate(a, update, 'relay');
    for (const update of toB.splice(0)) Y.applyUpdate(b, update, 'relay');
    await expectColdLayout();
    const typed = xmlOf(await left.save());
    for (const text of ['ARow 8', 'BRow 9', 'CHead 12', 'DRow 13']) expect(typed).toContain(text);
    // Text that wraps raises its row and takes the full layout on both sides.
    typeAt(right, 9, 1, ' and much more text that wraps onto a second line');
    await expectColdLayout();
    expect(right.exec({ type: 'undo' }).ok).toBe(true);
    await expectColdLayout();
    expect(right.exec({ type: 'redo' }).ok).toBe(true);
    await expectColdLayout();
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
