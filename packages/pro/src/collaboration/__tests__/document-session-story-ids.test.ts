/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Content created during a session is named by logical id, which carries no part name. Edits,
// review decisions, presence, and protection checks on that content must still find the
// header, footer, or note part that holds it, not the body.
import { afterEach, expect, test } from 'bun:test';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import type { EditorCommand } from '@docx-editor.dev/core/contracts/editor';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer, W, R, REL } from './document-peer-support.ts';
import { packageFingerprint } from './document-support.ts';

const harness = createPeerHarness('session-story-ids', { offlineEditing: true });
const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  harness.cleanup();
});

const HT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const FT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml';
const NT = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml';
const ST = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml';

function fixture(settings = '') {
  return zipDocument(
    '<w:p><w:r><w:t>Body one</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
      '<w:p><w:r><w:t>Body two</w:t></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/>' +
      '<w:footerReference w:type="default" r:id="rIdF"/>' +
      (settings ? '<w:formProt w:val="0"/>' : '') +
      '</w:sectPr>',
    {
      overrides:
        `<Override PartName="/word/header1.xml" ContentType="${HT}"/>` +
        `<Override PartName="/word/footer1.xml" ContentType="${FT}"/>` +
        `<Override PartName="/word/footnotes.xml" ContentType="${NT}"/>` +
        (settings ? `<Override PartName="/word/settings.xml" ContentType="${ST}"/>` : ''),
      documentRels:
        `<Relationships xmlns="${REL}">` +
        `<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>` +
        `<Relationship Id="rIdF" Type="${R}/footer" Target="footer1.xml"/>` +
        `<Relationship Id="rIdN" Type="${R}/footnotes" Target="footnotes.xml"/>` +
        (settings ? `<Relationship Id="rIdS" Type="${R}/settings" Target="settings.xml"/>` : '') +
        '</Relationships>',
      extraXml: {
        'word/header1.xml': `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Head one</w:t></w:r></w:p></w:hdr>`,
        'word/footer1.xml': `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>Foot one</w:t></w:r></w:p></w:ftr>`,
        'word/footnotes.xml':
          `<w:footnotes xmlns:w="${W}">` +
          '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
          '<w:footnote w:id="1"><w:p><w:r><w:t>Note one</w:t></w:r></w:p></w:footnote></w:footnotes>',
        ...(settings
          ? { 'word/settings.xml': `<w:settings xmlns:w="${W}">${settings}</w:settings>` }
          : {}),
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
    modules: [reviewModule(), collaborationModule({ session: peer.room.session })],
  });
  editors.push(editor);
  return editor;
}

async function pairUp(bytes: Uint8Array) {
  const pair = await harness.pair(bytes);
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

type Story = 'header' | 'footer' | 'note';
const PART: Record<Story, string> = {
  header: '/word/header1.xml',
  footer: '/word/footer1.xml',
  note: '/word/footnotes.xml',
};

/** Open the story for editing and return its paragraph ids. */
function enter(editor: DocxEditorInstance, story: Story): string[] {
  const surface = editor.surface!;
  if (story === 'note') {
    const scope = surface.layout().pages.flatMap((page) => page.footnotes?.notes ?? [])[0]!.scopeId;
    expect(surface.enterNote(scope)).toBe(true);
  } else {
    expect(editor.exec({ type: 'editHeaderFooter', position: story }).ok).toBe(true);
  }
  return [...surface.session.paragraphIdsIn(surface.storyScope())];
}

function select(editor: DocxEditorInstance, from: string, start: number, to = from, end = start) {
  editor.surface!.setSelection({
    anchor: { paragraphId: from, offset: start },
    head: { paragraphId: to, offset: end },
  });
}

function partXml(editor: DocxEditorInstance, name: string): string {
  const part = editor.surface!.session.currentPackage().parts.get(name);
  return part ? serializeOoxmlPart(part) : '';
}

/** The serialized `w:p` that holds `marker`. */
function paragraphHolding(xml: string, marker: string): string {
  return xml.split(/(?=<w:p[ >])/).find((chunk) => chunk.includes(marker)) ?? '';
}

/** Bob presses Enter in the story and types a line; Alice opens the story on that line. */
async function peerLine(story: Story) {
  const session = await pairUp(fixture());
  const { alice, bob, flush } = session;
  const first = enter(bob, story)[0]!;
  select(bob, first, 4);
  bob.surface!.splitParagraph();
  bob.surface!.type('PEERLINE');
  await flush();
  const line = enter(alice, story).find((id) => !id.includes('#'));
  expect(line).toBeDefined();
  return { ...session, line: line! };
}

const PARAGRAPH_COMMANDS: readonly (readonly [EditorCommand, string])[] = [
  [{ type: 'setAlignment', align: 'center' }, '<w:jc '],
  [{ type: 'setParagraphSpacing', beforePt: 12 }, '<w:spacing '],
  [{ type: 'setLineSpacing', rule: 'multiple', value: 2 }, '<w:spacing '],
  [{ type: 'setParagraphDirection', direction: 'rtl' }, '<w:bidi'],
];

for (const story of ['header', 'footer', 'note'] as const) {
  for (const [command, element] of PARAGRAPH_COMMANDS) {
    test(`${command.type} reaches a line a peer added to the ${story}`, async () => {
      const { alice, bob, flush, line } = await peerLine(story);
      select(alice, line, 2, line, 5);
      expect(alice.can(command)).toEqual({ ok: true });
      expect(alice.exec(command)).toMatchObject({ ok: true, changed: true });
      await flush();
      expect(paragraphHolding(partXml(bob, PART[story]), 'PEERLINE')).toContain(element);
    });
  }

  test(`suggested alignment on a peer's ${story} line records a revision`, async () => {
    const { alice, bob, flush, line } = await peerLine(story);
    expect(alice.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
    select(alice, line, 2, line, 5);
    expect(alice.exec({ type: 'setAlignment', align: 'center' })).toMatchObject({ ok: true });
    await flush();
    const paragraph = paragraphHolding(partXml(bob, PART[story]), 'PEERLINE');
    expect(paragraph).toContain('<w:jc w:val="center"/>');
    expect(paragraph).toContain('<w:pPrChange ');
  });

  // Remote carets are drawn in headers and footers; notes show none, for loaded lines too.
  if (story !== 'note')
    test(`a remote caret on a peer's ${story} line shows at its node`, async () => {
      const { pair, alice, flush, line } = await peerLine(story);
      select(alice, line, 3);
      await flush();
      applyAwarenessUpdate(
        pair.bob.awareness,
        encodeAwarenessUpdate(pair.alice.awareness, [pair.alice.ydoc.clientID]),
        'test'
      );
      const remote = pair.bob.room.session.remoteSelections()[0];
      expect(remote?.head).toMatchObject({ offset: 3 });
      expect(remote?.head.nodeId).toBeDefined();
    });
}

test('a peer can reject changes suggested in a header created during the session', async () => {
  const { alice, bob, flush } = await pairUp(
    zipDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/>')
  );
  expect(bob.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  bob.surface!.type('NewHead');
  await flush();
  expect(alice.exec({ type: 'editHeaderFooter', position: 'header' }).ok).toBe(true);
  const ids = [...alice.surface!.session.paragraphIdsIn(alice.surface!.storyScope())];
  const headerName = [...bob.surface!.session.currentPackage().parts.keys()].find((name) =>
    name.startsWith('/word/header')
  )!;
  expect(alice.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
  select(alice, ids[0]!, 3);
  alice.surface!.type('S');
  select(alice, ids[0]!, 0, ids[0]!, 2);
  expect(alice.exec({ type: 'setAlignment', align: 'center' }).ok).toBe(true);
  await flush();
  expect(partXml(bob, headerName)).toMatch(/<w:ins |<w:pPrChange /);

  const result = bob.exec({ type: 'resolveAllReviewChanges', action: 'reject' });
  expect(result).toMatchObject({ ok: true, changed: true });
  if (result.ok) expect(result.revisions?.skipped).toEqual([]);
  await flush();
  expect(packageFingerprint(alice.surface!.session.currentPackage())).toBe(
    packageFingerprint(bob.surface!.session.currentPackage())
  );
  const after = partXml(alice, headerName);
  expect(after).not.toMatch(/<w:ins |<w:pPrChange |<w:jc /);
  expect([...after.matchAll(/<w:t>([^<]*)<\/w:t>/g)].map((match) => match[1]).join('')).toBe(
    'NewHead'
  );
});

test("a peer's content control in a header can be filled", async () => {
  const { alice, bob, flush } = await pairUp(fixture());
  enter(bob, 'header');
  const alicePara = enter(alice, 'header')[0]!;
  const bobPara = [...bob.surface!.session.paragraphIdsIn(bob.surface!.storyScope())][0]!;
  select(bob, bobPara, 5, bobPara, 8);
  expect(
    bob.exec({ type: 'insertContentControl', subtype: 'plainText', tag: 'T' } as EditorCommand)
  ).toMatchObject({ ok: true });
  await flush();
  select(alice, alicePara, 6);
  expect(
    alice.exec({ type: 'setContentControlValue', value: 'FILLED' } as EditorCommand)
  ).toMatchObject({ ok: true, changed: true });
  await flush();
  expect(partXml(bob, PART.header)).toContain('FILLED');
});

test('typing after Enter in an unprotected section of a forms-protected document', async () => {
  const { alice } = await pairUp(
    fixture('<w:documentProtection w:edit="forms" w:enforcement="1"/>')
  );
  const first = alice.surface!.session.paragraphIds()[0]!;
  select(alice, first, 2);
  expect(alice.can({ type: 'insertText', text: 'z' })).toEqual({ ok: true });
  select(alice, first, 4);
  alice.surface!.splitParagraph();
  const own = alice.surface!.session.paragraphIds().find((id) => !id.includes('#'));
  expect(own).toBeDefined();
  select(alice, own!, 0);
  // The new line is in the same unprotected section, so the answer is the same.
  expect(alice.can({ type: 'insertText', text: 'z' })).toEqual({ ok: true });
});
