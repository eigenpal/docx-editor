/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A session names the nodes it creates by logical id, which carries no part name. Every
// feature that reads a node's part from its id must still find the part for such a node: a
// table a peer added to a header, a paragraph a peer added to the second section, a control
// a peer added to the body, or a line a peer added to a note.
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { findNode, serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import {
  customNodesModule,
  defineCustomNode,
  insertCustomNode,
  recognizeCustomNodes,
  removeCustomNode,
} from '../../index.ts';
import { createPeerHarness, zipDocument, type Peer, W, R, REL } from './document-peer-support.ts';
import { packageFingerprint } from './document-support.ts';
import { offeredHit, partOfTableIn } from '../../../../core/src/editor/surface-table-story.ts';
import { readEditableTableTopology } from '../../../../core/src/store/store/tree-op-table-topology.ts';

const citation = defineCustomNode({ name: 'citation', tagPrefix: 'acme' });

const harness = createPeerHarness('session-id-readers', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const HT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const NT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const HEADER = '/word/header1.xml';

/** Two sections of different sizes, a header, and a note cited from the second section. */
function fixture() {
  return zipDocument(
    '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rIdH"/>' +
      '<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr>' +
      '<w:r><w:t>First section</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Second section</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/>' +
      '<w:pgSz w:w="11906" w:h="16838"/></w:sectPr>',
    {
      overrides:
        `<Override PartName="${HEADER}" ContentType="${HT}"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${NT}"/>`,
      documentRels:
        `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdN" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        '</Relationships>',
      extraXml: {
        'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Head one</w:t></w:r></w:p></w:hdr>`,
        'word/footnotes.xml':
          `<w:footnotes xmlns:w="${W}">` +
          '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:id="1"><w:p><w:r><w:t>Note one</w:t></w:r></w:p></w:footnote></w:footnotes>',
      },
    }
  );
}

function mount(peer: Peer, author: string) {
  peer.detach();
  const container = document.createElement('div');
  document.body.append(container);
  containers.push(container);
  const editor = createDocxEditor({
    container,
    document: peer.room.document,
    author,
    modules: [
      reviewModule(),
      customNodesModule({ nodes: [citation] }),
      collaborationModule({ session: peer.room.session }),
    ],
  });
  editors.push(editor);
  return editor;
}

async function pairUp() {
  const pair = await harness.pair(fixture());
  const alice = mount(pair.alice, 'Alice');
  const bob = mount(pair.bob, 'Bob');
  const flush = async () => {
    for (let round = 0; round < 3; round += 1) {
      pair.alice.room.session.flushPendingJournals();
      pair.bob.room.session.flushPendingJournals();
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  };
  return { pair, alice, bob, flush };
}

function select(editor: DocxEditorInstance, from: string, start: number, to = from, end = start) {
  editor.surface!.setSelection({
    anchor: { paragraphId: from, offset: start },
    head: { paragraphId: to, offset: end },
  });
}

function textOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(textOf).join('');
}

/** The body paragraph whose text is `text`. */
function bodyParagraph(editor: DocxEditorInstance, text: string): string {
  const session = editor.surface!.session;
  const id = session.paragraphIds().find((candidate) => {
    const node = findNode(session.part(), candidate);
    return node !== null && textOf(node) === text;
  });
  expect(id).toBeDefined();
  return id!;
}

/** Bob presses Enter at the end of the second section's paragraph and types a line. */
async function peerBodyLine() {
  const session = await pairUp();
  const { alice, bob, flush } = session;
  const second = bodyParagraph(bob, 'Second section');
  select(bob, second, 'Second section'.length + 1);
  bob.surface!.splitParagraph();
  bob.surface!.type('PEERLINE');
  await flush();
  const line = bodyParagraph(alice, 'PEERLINE');
  expect(line.includes('#')).toBe(false);
  return { ...session, line };
}

/** The first table anywhere under a node. */
function firstTable(root: OoxmlNode): OoxmlNode | undefined {
  if (root.kind === 'textValue') return undefined;
  if (root.kind === 'table') return root;
  for (const child of root.children) {
    const found = firstTable(child);
    if (found) return found;
  }
  return undefined;
}

const sizeOf = (editor: DocxEditorInstance, paragraphId: string) =>
  editor.surface!.sectionPropertiesAt(paragraphId).pageSize;

test('the table pointer controls find a table a peer added to a header', async () => {
  const { alice, bob, flush } = await pairUp();
  // The header belongs to the second section, so both enter it from there.
  select(bob, bodyParagraph(bob, 'Second section'), 1);
  select(alice, bodyParagraph(alice, 'Second section'), 1);
  expect(bob.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  const bobHeaderLine = [...bob.surface!.session.paragraphIdsIn(bob.surface!.storyScope())][0]!;
  select(bob, bobHeaderLine, 4);
  expect(bob.exec({ type: 'insertTable', rows: 2, cols: 2 }).ok).toBe(true);
  await flush();

  expect(alice.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  const session = alice.surface!.session;
  const header = session.currentPackage().parts.get(HEADER)!;
  const table = firstTable(header.root);
  expect(table, serializeOoxmlPart(header)).toBeDefined();
  expect(table!.id.includes('#')).toBe(false);

  // Planning reads the header part, so a divider drag or an insert button has a table to plan.
  expect(partOfTableIn(session, table!.id).name).toBe(HEADER);
  expect(readEditableTableTopology(partOfTableIn(session, table!.id).root, table!.id).ok).toBe(
    true
  );

  // The controls show while the reader stands in that header, on a line loaded from the file.
  const headerLine = [...session.paragraphIdsIn(alice.surface!.storyScope())].find((id) =>
    id.startsWith(`${HEADER}#`)
  )!;
  const hit = { kind: 'insertRow', tableId: table!.id } as unknown as Parameters<
    typeof offeredHit
  >[1];
  expect(offeredHit(session, hit, headerLine)).toBe(hit);
  // And not while the reader stands in a body line.
  const bodyLine = alice.surface!.session.paragraphIds()[0]!;
  expect(offeredHit(session, hit, bodyLine)).toBeNull();
});

test('a peer table in the body offers no controls to a reader in a header line', async () => {
  const { alice, bob, flush } = await pairUp();
  const first = bodyParagraph(bob, 'First section');
  select(bob, first, 0);
  expect(bob.exec({ type: 'insertTable', rows: 1, cols: 2 }).ok).toBe(true);
  await flush();
  const session = alice.surface!.session;
  const table = firstTable(session.part().root);
  expect(table && !table.id.includes('#')).toBe(true);
  expect(alice.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  const headerLine = [...session.paragraphIdsIn(alice.surface!.storyScope())][0]!;
  const hit = { kind: 'insertRow', tableId: table!.id } as unknown as Parameters<
    typeof offeredHit
  >[1];
  expect(offeredHit(session, hit, headerLine)).toBeNull();
  expect(partOfTableIn(session, table!.id).name).toBe(session.part().name);
});

test('page setup reads and writes the section of a line a peer added', async () => {
  const { alice, bob, flush, line } = await peerBodyLine();
  select(alice, line, 2);
  expect(sizeOf(alice, line)).toMatchObject({ widthTwips: 11906, heightTwips: 16838 });
  expect(alice.exec({ type: 'setPageSetup', scope: 'section', orientation: 'landscape' }).ok).toBe(
    true
  );
  await flush();
  const first = bodyParagraph(bob, 'First section');
  expect(sizeOf(bob, first)).toMatchObject({ widthTwips: 12240, heightTwips: 15840 });
  expect(sizeOf(bob, bodyParagraph(bob, 'PEERLINE'))).toMatchObject({
    widthTwips: 16838,
    heightTwips: 11906,
  });
  expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.surface!.session.currentPackage())
  );
});

test('a line a peer added to a note reads the section that cites the note', async () => {
  const { alice, bob, flush } = await pairUp();
  const surface = bob.surface!;
  const scope = surface.layout().pages.flatMap((page) => page.footnotes?.notes ?? [])[0]!.scopeId;
  expect(surface.enterNote(scope)).toBe(true);
  const noteLine = [...surface.session.paragraphIdsIn(surface.storyScope())][0]!;
  select(bob, noteLine, 'Note one'.length);
  surface.splitParagraph();
  surface.type('PEERNOTE');
  await flush();
  const aliceScope = alice
    .surface!.layout()
    .pages.flatMap((page) => page.footnotes?.notes ?? [])[0]!.scopeId;
  expect(alice.surface!.enterNote(aliceScope)).toBe(true);
  const added = [...alice.surface!.session.paragraphIdsIn(alice.surface!.storyScope())].find(
    (id) => !id.includes('#')
  );
  expect(added).toBeDefined();
  select(alice, added!, 2);
  expect(sizeOf(alice, added!)).toMatchObject({ widthTwips: 11906, heightTwips: 16838 });
});

test('the control at the caret is a control a peer added to the body', async () => {
  const { alice, bob, flush, line } = await peerBodyLine();
  const bobLine = bodyParagraph(bob, 'PEERLINE');
  select(bob, bobLine, 0, bobLine, 'PEERLINE'.length);
  expect(
    bob.exec({ type: 'insertContentControl', subtype: 'richText', tag: 'PEERCC' } as never).ok
  ).toBe(true);
  await flush();
  const added = bodyParagraph(alice, 'PEERLINE');
  expect(added).toBeDefined();
  select(alice, added, 3);
  const control = alice.surface!.contentControls.atCaret();
  expect(control).not.toBeNull();
  expect(control!.id.includes('#')).toBe(false);
  void line;
});

test('a comment on a line a peer added lands in the body while a header is open', async () => {
  const { alice, bob, flush, line } = await peerBodyLine();
  expect(alice.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  select(alice, line, 0, line, 4);
  expect(alice.addComment('peer line remark')).toMatchObject({ ok: true });
  await flush();
  const body = serializeOoxmlPart(bob.surface!.session.part());
  expect(body).toContain('<w:commentRangeStart');
});

test('the link at the caret is found in a line a peer added', async () => {
  const { alice, bob, flush } = await peerBodyLine();
  const bobLine = bodyParagraph(bob, 'PEERLINE');
  select(bob, bobLine, 0, bobLine, 4);
  expect(bob.exec({ type: 'insertHyperlink', href: 'https://example.com/peer' }).ok).toBe(true);
  await flush();
  const line = bodyParagraph(alice, 'PEERLINE');
  select(alice, line, 2);
  expect(alice.query({ type: 'hyperlinkAt' })).toMatchObject({
    href: 'https://example.com/peer',
  });
});

test('a custom node a peer added to the body is removed while a header is open', async () => {
  const { alice, bob, flush } = await peerBodyLine();
  const bobLine = bodyParagraph(bob, 'PEERLINE');
  expect(
    insertCustomNode(bob, citation, {
      attrs: { sourceId: 's1' },
      text: 'CITE',
      at: { paragraphId: bobLine, offset: 4 },
    })
  ).toMatchObject({ ok: true });
  await flush();
  const [node] = recognizeCustomNodes(alice.surface!.session.part(), [citation]);
  expect(node?.nodeId.includes('#')).toBe(false);
  expect(alice.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  expect(removeCustomNode(alice, node!.nodeId)).toMatchObject({ ok: true });
  await flush();
  expect(recognizeCustomNodes(bob.surface!.session.part(), [citation])).toEqual([]);
  expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.surface!.session.currentPackage())
  );
});
