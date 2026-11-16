/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Shape fill and outline edits in two collaborating editors. Concurrent fills and outlines on
// one shape converge to one fill choice and one `a:ln`; undo, redo, deletion against an edit,
// an offline edit that reconnects, and a late join all save the same document.
import { expect, test } from 'bun:test';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { strToU8, zipSync } from 'fflate';
import {
  createDocxEditor,
  editSelectedShape,
  readSelectedShape,
} from '@docx-editor.dev/core/editor';
import {
  readOoxmlPackage,
  canonicalOoxmlFingerprint,
  serializeOoxmlPart,
} from '@docx-editor.dev/core/store';
import { createDocumentCollaboration } from '../document-session.ts';
import { collaborationModule } from '../collaboration-module.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS =
  'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ' +
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml"';

const SHAPE =
  `<mc:AlternateContent ${NS}><mc:Choice Requires="wps"><w:drawing><wp:anchor distT="0" distB="0" ` +
  'distL="0" distR="0" simplePos="0" relativeHeight="1" behindDoc="0" locked="0" layoutInCell="1" ' +
  'allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:posOffset>0' +
  '</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset>' +
  '</wp:positionV><wp:extent cx="1828800" cy="457200"/><wp:effectExtent l="0" t="0" r="0" b="0"/>' +
  '<wp:wrapNone/><wp:docPr id="1" name="Box"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData ' +
  'uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/>' +
  '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="457200"/></a:xfrm><a:prstGeom ' +
  'prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill></wps:spPr>' +
  '<wps:bodyPr/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice><mc:Fallback>' +
  '<w:pict><v:rect id="_x0000_s1026" style="width:144pt;height:36pt" fillcolor="#d9e2f3" stroked="f"/>' +
  '</w:pict></mc:Fallback></mc:AlternateContent>';

function fixture(): Uint8Array {
  const document =
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
    '<w:p><w:r><w:t>Alpha paragraph</w:t></w:r></w:p>' +
    `<w:p><w:r>${SHAPE}<w:t>after</w:t></w:r></w:p>` +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
    '</w:body></w:document>';
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(document),
  });
}
const FIXTURE = fixture();

async function peer(name: string, host?: { ydoc: Y.Doc }) {
  const ydoc = new Y.Doc(),
    awareness = new Awareness(ydoc);
  if (host) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(host.ydoc));
  const room = await createDocumentCollaboration({
    ydoc,
    awareness,
    documentId: 'shape-format',
    identity: { actorId: name, name },
    bootstrap: host ? { kind: 'join' } : { kind: 'create', document: FIXTURE },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: room.document,
    modules: [collaborationModule({ session: room.session })],
  });
  return {
    ydoc,
    editor,
    destroy() {
      editor.destroy();
      container.remove();
      room.destroy();
      awareness.destroy();
      ydoc.destroy();
    },
  };
}
type Peer = Awaited<ReturnType<typeof peer>>;

function sync(a: Peer, b: Peer) {
  Y.applyUpdate(b.ydoc, Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc)), 'relay');
  Y.applyUpdate(a.ydoc, Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc)), 'relay');
}

async function documentXml(client: Peer): Promise<{ fingerprint: string; spPr: string }> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return { fingerprint: canonicalOoxmlFingerprint(part), spPr: spPrOf(part.root) };
}

/** The local names of the shape's `wps:spPr` and `a:ln` children, as one string. */
function spPrOf(node: unknown): string {
  const element = node as { kind?: string; localName?: string; children?: unknown[] };
  if (element.kind === 'textValue' || !element.children) return '';
  if (element.localName === 'spPr') {
    return element.children
      .map((child) => {
        const c = child as { localName: string; children?: unknown[] };
        return c.localName === 'ln'
          ? `ln(${(c.children ?? []).map((n) => (n as { localName: string }).localName).join(',')})`
          : c.localName;
      })
      .join(' ');
  }
  for (const child of element.children) {
    const found = spPrOf(child);
    if (found) return found;
  }
  return '';
}

async function converged(a: Peer, b: Peer): Promise<string> {
  const [left, right] = await Promise.all([documentXml(a), documentXml(b)]);
  expect(left.fingerprint).toBe(right.fingerprint);
  // One fill choice and at most one outline, whichever peer's write won.
  const fills = left.spPr.split(' ').filter((name) => /^(noFill|solidFill)$/.test(name));
  expect(fills.length).toBeLessThanOrEqual(1);
  expect(left.spPr.split(' ').filter((name) => name.startsWith('ln(')).length).toBeLessThanOrEqual(
    1
  );
  return left.spPr;
}

function select(client: Peer): void {
  const surface = client.editor.surface!;
  const host = surface.session.paragraphIds()[1]!;
  const find = (node: unknown): string | null => {
    const element = node as { kind?: string; localName?: string; id: string; children?: unknown[] };
    if (element.kind === 'textValue') return null;
    if (element.localName === 'AlternateContent') return element.id;
    for (const child of element.children ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const id = find(surface.session.part().root)!;
  expect(surface.selectDrawing(id, host)).toBe(true);
}

test('two editors converge on concurrent fill and outline edits, undo, delete, reconnect', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let late: Peer | undefined;
  try {
    // Concurrent fills on one shape: one fill choice survives on both.
    select(a);
    select(b);
    expect(a.editor.exec({ type: 'setShapeFill', color: 'FF0000' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeFill', visible: false })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Both give the shape its first outline: one `a:ln` survives.
    select(a);
    select(b);
    expect(a.editor.exec({ type: 'setShapeOutline', color: '0000FF' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeOutline', widthPt: 4 })).toMatchObject({ ok: true });
    sync(a, b);
    expect(await converged(a, b)).toContain('ln(');
    // Undo and redo travel.
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'redo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Alice deletes the shape while Bob recolours it.
    select(a);
    select(b);
    expect(a.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeFill', color: '00B050' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Bob edits offline, Alice edits too, then they reconnect.
    select(a);
    select(b);
    expect(b.editor.exec({ type: 'setShapeFill', transparency: 0.5 })).toMatchObject({ ok: true });
    expect(a.editor.exec({ type: 'setShapeOutline', visible: false })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    late = await peer('Late', a);
    await converged(a, late);
  } finally {
    late?.destroy();
    a.destroy();
    b.destroy();
  }
});

test('an outline dash reaches the other peer, converges, travels with undo, and survives a join', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  let late: Peer | undefined;
  const dashOf = (client: Peer) =>
    readSelectedShape(client.editor, client.editor.snapshot().image).format?.outline.dash;
  try {
    select(a);
    select(b);
    expect(a.editor.exec({ type: 'setShapeOutline', dash: 'sysDot' })).toMatchObject({ ok: true });
    sync(a, b);
    select(b);
    expect(dashOf(b)).toBe('sysDot');
    expect(await converged(a, b)).toContain('prstDash');
    // Concurrent dashes on one outline: one dash survives on both.
    select(a);
    select(b);
    expect(a.editor.exec({ type: 'setShapeOutline', dash: 'lgDash' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeOutline', dash: 'dashDot' })).toMatchObject({ ok: true });
    sync(a, b);
    const spPr = await converged(a, b);
    expect(spPr.match(/prstDash/g)).toHaveLength(1);
    select(a);
    select(b);
    expect(dashOf(a)).toBe(dashOf(b));
    // Undo and redo travel.
    expect(b.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(b.editor.exec({ type: 'redo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // Alice deletes the shape while Bob changes its dash; then she undoes the delete.
    select(a);
    select(b);
    expect(a.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    expect(b.editor.exec({ type: 'setShapeOutline', dash: 'solid' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(a.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    // A late joiner reads the same dash.
    select(a);
    expect(a.editor.exec({ type: 'setShapeOutline', dash: 'sysDash' })).toMatchObject({ ok: true });
    late = await peer('Late', a);
    await converged(a, late);
    select(late);
    expect(dashOf(late)).toBe('sysDash');
    const saved = await savedXml(late);
    expectConsistentShape(saved);
    // The VML fallback carries the same dash.
    expect(saved).toContain('dashstyle="shortdash"');
  } finally {
    late?.destroy();
    a.destroy();
    b.destroy();
  }
});

test('Format shape pane edits reach the other peer, its pane read follows, a delete empties it', async () => {
  const a = await peer('Alice'),
    b = await peer('Bob', a);
  const pane = (client: Peer) => readSelectedShape(client.editor, client.editor.snapshot().image);
  const edit = (client: Peer, change: Parameters<typeof editSelectedShape>[2]) =>
    editSelectedShape(client.editor, client.editor.snapshot().image, change);
  try {
    select(a);
    select(b);
    // A theme pick on one peer is the other peer's pane state after a sync.
    expect(edit(a, { type: 'fillColor', color: 'accent1' })).toMatchObject({ ok: true });
    sync(a, b);
    expect(pane(b).format?.fill).toMatchObject({ type: 'solid', color: '4472C4' });
    expect(pane(b).canEditFill).toBe(true);
    // The other way: a typed width and a picked outline color.
    expect(edit(b, { type: 'outlineWidth', text: '3' })).toMatchObject({ ok: true });
    expect(edit(b, { type: 'outlineColor', color: '#0070C0' })).toMatchObject({ ok: true });
    sync(a, b);
    expect(pane(a).format?.outline).toEqual({
      visible: true,
      color: '0070C0',
      widthPt: 3,
      dash: 'solid',
    });
    // Concurrent pane edits converge.
    expect(edit(a, { type: 'fillTransparency', text: '50' })).toMatchObject({ ok: true });
    expect(edit(b, { type: 'noFill' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(pane(a).format?.fill).toEqual(pane(b).format?.fill);
    // Undo travels and both panes read it.
    expect(b.editor.exec({ type: 'undo' })).toMatchObject({ ok: true });
    sync(a, b);
    await converged(a, b);
    expect(pane(a).format?.fill).toEqual(pane(b).format?.fill);
    // Alice deletes the shape while Bob's pane shows it: Bob's pane empties, edits refuse.
    expect(a.editor.exec({ type: 'deleteImage' })).toMatchObject({ ok: true });
    sync(a, b);
    expect(pane(b)).toMatchObject({ drawingNodeId: null, format: null, canEditFill: false });
    expect(edit(b, { type: 'fillColor', color: 'accent2' })).toMatchObject({
      ok: false,
      code: 'notFound',
    });
    await converged(a, b);
  } finally {
    a.destroy();
    b.destroy();
  }
});

/** The saved document part as XML. */
async function savedXml(client: Peer): Promise<string> {
  const loaded = readOoxmlPackage(new Uint8Array(await client.editor.save()));
  if (!loaded.ok) throw new Error(loaded.reason);
  return serializeOoxmlPart(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
}

/** The saved shape is valid: a hidden fill holds one fill, and the VML copy agrees. */
function expectConsistentShape(xml: string): void {
  expect(xml).not.toMatch(/<a14:hiddenFill[^>]*\/>/);
  expect(xml).not.toMatch(/<a14:hiddenFill[^>]*>\s*<\/a14:hiddenFill>/);
  const spPr = /<wps:spPr>(.*?)<\/wps:spPr>/.exec(xml)![1]!;
  const ownFill = spPr.replace(/<a:extLst>.*<\/a:extLst>/, '').replace(/<a:ln[ >].*<\/a:ln>/, '');
  const rect = /<v:rect [^>]*>/.exec(xml)![0];
  if (ownFill.includes('<a:noFill/>')) expect(rect).toContain('filled="f"');
  const color = /<a:solidFill><a:srgbClr val="([0-9A-F]{6})"/.exec(ownFill)?.[1];
  if (color) {
    expect(rect).not.toContain('filled="f"');
    expect(rect).toContain(`fillcolor="#${color.toLowerCase()}"`);
  }
}

test('a hidden fill against a recolour saves one valid fill and a VML copy that agrees', async () => {
  for (const order of ['hide-first', 'recolour-first'] as const) {
    const a = await peer('Alice'),
      b = await peer('Bob', a);
    try {
      select(a);
      select(b);
      const hide = { type: 'setShapeFill', visible: false } as const;
      const recolour = { type: 'setShapeFill', color: '7030A0' } as const;
      expect(a.editor.exec(order === 'hide-first' ? hide : recolour)).toMatchObject({ ok: true });
      expect(b.editor.exec(order === 'hide-first' ? recolour : hide)).toMatchObject({ ok: true });
      sync(a, b);
      await converged(a, b);
      const xml = await savedXml(a);
      expect(await savedXml(b)).toBe(xml);
      expectConsistentShape(xml);
      // Showing the fill again brings back exactly one fill.
      select(a);
      expect(a.editor.exec({ type: 'setShapeFill', visible: true })).toMatchObject({ ok: true });
      sync(a, b);
      await converged(a, b);
      expectConsistentShape(await savedXml(b));
    } finally {
      a.destroy();
      b.destroy();
    }
  }
});
