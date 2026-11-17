/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A table positioned against the text (ECMA-376 Part 1, 17.4.57) counts its offset from the top
// of its anchor paragraph, above that paragraph's space before. Two connected editors that type in
// the paragraph above the table and in the anchor concurrently, delete text in the anchor while
// the other side types after it, and undo and redo, lay the page out exactly as a cold open of
// the saved document does.
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
const spaced = (text: string, before: number, after: number) =>
  `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/></w:pPr>` +
  `<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const float =
  '<w:tbl><w:tblPr><w:tblpPr w:leftFromText="180" w:rightFromText="180" w:vertAnchor="text" ' +
  'w:horzAnchor="margin" w:tblpY="600"/><w:tblW w:w="4000" w:type="dxa"/>' +
  '<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>' +
  `<w:tr><w:trPr><w:trHeight w:val="2000" w:hRule="exact"/></w:trPr><w:tc>${p('Float')}</w:tc></w:tr></w:tbl>`;
const source = `${spaced('Lead', 0, 80)}${float}${spaced('Anchor', 480, 0)}${p('Tail')}`;
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

/** The id of the paragraph whose text holds `prefix`. */
function paragraphId(editor: Editor, prefix: string): string {
  let found: string | undefined;
  const textOf = (node: OoxmlNode): string =>
    node.kind === 'textValue' ? node.value : node.children.map(textOf).join('');
  const walk = (node: OoxmlNode) => {
    if (found || node.kind === 'textValue') return;
    if (node.kind === 'paragraph' && textOf(node).includes(prefix)) found = node.id;
    else for (const child of node.children) walk(child);
  };
  walk(editor.surface!.session.part().root);
  if (!found) throw new Error(`no paragraph holds ${prefix}`);
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

/** The box of the table, or of the paragraph, whose first text starts with `prefix`. */
function boxOf(editor: Editor, prefix: string): { y: number; height: number } {
  const id = paragraphId(editor, prefix);
  const fragment = editor
    .surface!.layout()
    .pages[0]!.fragments.find((f) =>
      f.kind === 'table'
        ? f.rows.some((row) =>
            row.cells.some((cell) =>
              cell.blocks.some((block) => block.kind === 'paragraph' && block.paragraphId === id)
            )
          )
        : f.kind === 'paragraph' && f.paragraphId === id
    )!;
  return fragment.box;
}

/** The table opens 30pt below the top of its anchor paragraph, above the anchor's space before. */
function expectAnchorTop(editor: Editor): void {
  const lead = boxOf(editor, 'Lead');
  const anchor = boxOf(editor, 'Anchor');
  expect(anchor.y).toBeCloseTo(lead.y + lead.height, 0);
  expect(boxOf(editor, 'Float').y).toBeCloseTo(anchor.y + 30, 0);
}

function xmlOf(saved: Uint8Array | ArrayBuffer): string {
  const read = readOoxmlPackage(saved instanceof Uint8Array ? saved : new Uint8Array(saved));
  if (!read.ok) throw new Error(read.reason);
  return serializeOoxmlPart(read.package.parts.get(read.package.mainDocumentPart)!);
}

test('two editors editing around a text-anchored table lay out as a cold open', async () => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const aa = new Awareness(a);
  const ba = new Awareness(b);
  const leftRoom = await createDocumentCollaboration({
    ydoc: a,
    awareness: aa,
    documentId: 'float-anchor-top',
    identity: { actorId: 'alice', name: 'Alice' },
    bootstrap: { kind: 'create', document: zipDocument(source) },
  });
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'relay');
  const rightRoom = await createDocumentCollaboration({
    ydoc: b,
    awareness: ba,
    documentId: 'float-anchor-top',
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
    expectAnchorTop(left);
    expectAnchorTop(right);
    // In the paragraph above the table and in its anchor at once.
    paused = true;
    typeAt(left, 'Lead', 'Longer ');
    typeAt(right, 'Anchor', 'Edited ');
    flush();
    await expectColdLayout();
    const typed = xmlOf(await left.save());
    for (const text of ['Longer Lead', 'Edited Anchor']) expect(typed).toContain(text);
    expectAnchorTop(left);
    // One side deletes text in the anchor while the other types after it.
    paused = true;
    deleteAt(left, 'Edited', 0, 'Edited '.length);
    typeAt(right, 'Tail', 'Later ');
    flush();
    await expectColdLayout();
    expect(right.exec({ type: 'undo' }).ok).toBe(true);
    await expectColdLayout();
    expect(right.exec({ type: 'redo' }).ok).toBe(true);
    await expectColdLayout();
    expectAnchorTop(right);
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
