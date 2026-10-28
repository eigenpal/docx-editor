/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A Word list pasted on one peer lands with the same geometry and format on every replica.
//
// Word writes a right-aligned number's `text-indent` as `-margin-left` and keeps the real hang
// in `mso-text-indent-alt`, states number positions in `@list` rules, and may send a `<li>` with
// neither a level rule nor a marker. The paste reads all three into ordinary `w:ind` and levels.

import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('paste-word-list-indent-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const item = (level: number, alt: string, marker: string, text: string): string =>
  `<p style="margin-left:${level * 36}pt;text-indent:${alt ? -level * 36 : -18}pt;` +
  `${alt}mso-list:l0 level${level} lfo2"><span style="mso-list:Ignore">` +
  `${alt ? '<span>&nbsp;&nbsp;&nbsp;&nbsp;</span>' : ''}${marker}` +
  `<span>&nbsp;&nbsp;</span></span>${text}</p>`;

async function pastedOnBoth(plain: string, html: string): Promise<Editor> {
  const peers = await harness.pair(zipDocument('<w:p><w:r><w:t>Body</w:t></w:r></w:p><w:sectPr/>'));
  const [alice, bob] = [peers.alice, peers.bob].map((peer) => {
    peer.detach();
    const editor = createDocxEditor({
      container: document.createElement('div'),
      document: peer.room.document,
      modules: [collaborationModule({ session: peer.room.session })],
    });
    editors.push(editor);
    return editor;
  }) as [Editor, Editor];

  alice.surface!.selectAll();
  expect(alice.surface!.pasteRich(plain, html)).toBe(true);
  peers.alice.room.session.flushPendingJournals();
  peers.bob.room.session.flushPendingJournals();
  alice.surface!.layout();
  bob.surface!.layout();

  const left = alice.surface!.session.currentPackage();
  const right = bob.surface!.session.currentPackage();
  expect(packageFingerprint(right)).toBe(packageFingerprint(left));
  expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
  return bob;
}

test('a pasted right-aligned Word list number replicates with its authored hanging', async () => {
  const bob = await pastedOnBoth(
    'Nested\nIndented\nOn',
    item(2, '', 'a.', 'Nested') +
      item(3, 'mso-text-indent-alt:-18.0pt;', 'i.', 'Indented') +
      item(2, '', 'b.', 'On')
  );
  const roman = serializeOoxmlPart(bob.surface!.session.part())
    .split('</w:p>')
    .find((paragraph) => paragraph.includes('Indented'));
  expect(roman).toContain('w:left="2160"');
  expect(roman).toContain('w:hanging="360"');
});

test('pasted Word list positions and marker-free items replicate as numbered levels', async () => {
  const bob = await pastedOnBoth(
    'Ten\nOne',
    '<html><head><style>@list l0:level1 {mso-level-number-position:right;}\n' +
      '@list l1 {mso-list-id:1;}</style></head><body>' +
      '<p style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">10.</span>Ten</p>' +
      '<ol start=1 type=1><li style="mso-list:l1 level1 lfo2">One</li></ol></body></html>'
  );
  const numbering = serializeOoxmlPart(
    bob.surface!.session.currentPackage().parts.get('/word/numbering.xml')!
  );
  expect(numbering).toContain('<w:lvlJc w:val="right"/>');
  expect(numbering).not.toMatch(/<w:lvl w:ilvl="0">(?:(?!<\/w:lvl>).)*w:val="bullet"/);
});
