/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Two participants decide one recorded paragraph property change at the same time, and one of
// them also undoes a decision. Each decision moves the recorded properties back into `w:pPr`.
// The merged result must hold each property once, keep the recorded properties of a change
// that is still pending, and be the same on both replicas.
import { afterEach, expect, test } from 'bun:test';
import { createDocxEditor, type DocxEditorInstance } from '@docx-editor.dev/core/editor';
import { serializeOoxmlPart, validateOoxmlPart } from '@docx-editor.dev/core/store';
import { reviewModule } from '../../review/review-module.ts';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument, type Peer } from './document-peer-support.ts';
import { mainPart, packageFingerprint, saveReopenDigest } from './document-support.ts';

const editors: DocxEditorInstance[] = [];
const containers: HTMLElement[] = [];
const harnesses: ReturnType<typeof createPeerHarness>[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const container of containers.splice(0)) container.remove();
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

const ADA = 'w:id="7" w:author="Ada" w:date="2026-01-01T00:00:00Z"';
/** A change the file already holds: indent and alignment, recorded over an earlier indent. */
const LOADED =
  `<w:p><w:pPr><w:ind w:left="720"/><w:jc w:val="center"/><w:pPrChange ${ADA}>` +
  '<w:pPr><w:ind w:left="240"/></w:pPr></w:pPrChange></w:pPr><w:r><w:t>loaded</w:t></w:r></w:p><w:sectPr/>';
/** The same, recording two properties. */
const LOADED_TWO =
  `<w:p><w:pPr><w:spacing w:before="240"/><w:ind w:left="720"/><w:pPrChange ${ADA}>` +
  '<w:pPr><w:spacing w:before="120"/><w:ind w:left="240"/></w:pPr></w:pPrChange></w:pPr>' +
  '<w:r><w:t>loaded</w:t></w:r></w:p><w:sectPr/>';
/** A plain paragraph that a participant formats in suggesting mode during the session. */
const PLAIN =
  '<w:p><w:pPr><w:ind w:left="240"/></w:pPr><w:r><w:t>outside</w:t></w:r></w:p><w:sectPr/>';

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

/** The first paragraph's `w:pPr`, without namespace declarations or dates. */
function paragraphProperties(editor: DocxEditorInstance): string {
  const xml = serializeOoxmlPart(mainPart(editor.surface!.session.currentPackage()))
    .replace(/ xmlns:\w+="[^"]*"/g, '')
    .replace(/ w:date="[^"]*"/g, '');
  return /<w:pPr>.*?<\/w:pPr>(?=<w:r>)/.exec(xml)?.[0] ?? '';
}

const reject = (editor: DocxEditorInstance) =>
  expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'reject' }).ok).toBe(true);
const accept = (editor: DocxEditorInstance) =>
  expect(editor.exec({ type: 'resolveAllReviewChanges', action: 'accept' }).ok).toBe(true);
const undo = (editor: DocxEditorInstance) => expect(editor.exec({ type: 'undo' }).ok).toBe(true);

interface Race {
  readonly name: string;
  readonly body: string;
  /** Alice formats the paragraph in suggesting mode first, while the transport runs. */
  readonly suggestFirst?: boolean;
  readonly alice: (editor: DocxEditorInstance) => void;
  readonly bob: (editor: DocxEditorInstance) => void;
  readonly expected: string;
}

const RACES: readonly Race[] = [
  {
    name: 'a peer rejects a session suggestion while its author undoes it',
    body: PLAIN,
    suggestFirst: true,
    alice: undo,
    bob: reject,
    expected: '<w:pPr><w:ind w:left="240"/></w:pPr>',
  },
  {
    name: 'one participant rejects and undoes while the other rejects',
    body: LOADED,
    alice: (editor) => {
      reject(editor);
      undo(editor);
    },
    bob: reject,
    expected: '<w:pPr><w:ind w:left="240"/></w:pPr>',
  },
  {
    name: 'one participant accepts and undoes while the other rejects',
    body: LOADED,
    alice: (editor) => {
      accept(editor);
      undo(editor);
    },
    bob: reject,
    expected: '<w:pPr><w:ind w:left="240"/></w:pPr>',
  },
  {
    name: 'both participants reject and undo',
    body: LOADED,
    alice: (editor) => {
      reject(editor);
      undo(editor);
    },
    bob: (editor) => {
      reject(editor);
      undo(editor);
    },
    expected:
      '<w:pPr><w:ind w:left="720"/><w:jc w:val="center"/><w:pPrChange w:author="Ada" w:id="7">' +
      '<w:pPr><w:ind w:left="240"/></w:pPr></w:pPrChange></w:pPr>',
  },
  {
    name: 'a change that records two properties: reject and undo against a reject',
    body: LOADED_TWO,
    alice: (editor) => {
      reject(editor);
      undo(editor);
    },
    bob: reject,
    expected: '<w:pPr><w:spacing w:before="120"/><w:ind w:left="240"/></w:pPr>',
  },
];

// Concurrent inserts at one place order by Yjs client id, so each race runs in both orders.
const ORDERS = [
  { alice: 1, bob: 2 },
  { alice: 2, bob: 1 },
] as const;

for (const race of RACES) {
  for (const order of ORDERS) {
    test(`${race.name} (Alice client ${order.alice})`, async () => {
      const harness = createPeerHarness(
        `paragraph-change-decisions-${order.alice}`,
        { offlineEditing: true },
        order
      );
      harnesses.push(harness);
      const pair = await harness.pair(zipDocument(race.body));
      const alice = mount(pair.alice, 'Alice');
      const bob = mount(pair.bob, 'Bob');
      const settle = async () => {
        for (let round = 0; round < 4; round += 1) {
          pair.alice.room.session.flushPendingJournals();
          pair.bob.room.session.flushPendingJournals();
          await new Promise((resolve) => setTimeout(resolve, 2));
        }
      };
      const paragraphId = alice.surface!.session.paragraphIds()[0]!;
      for (const editor of [alice, bob]) {
        editor.surface!.setSelection({
          anchor: { paragraphId, offset: 1 },
          head: { paragraphId, offset: 3 },
        });
      }
      if (race.suggestFirst) {
        expect(alice.exec({ type: 'setEditingMode', mode: 'suggesting' }).ok).toBe(true);
        expect(alice.exec({ type: 'setAlignment', align: 'center' }).ok).toBe(true);
        await settle();
        expect(paragraphProperties(bob)).toContain('<w:pPrChange');
      }

      pair.pause();
      race.alice(alice);
      race.bob(bob);
      pair.resume();
      await settle();

      const left = alice.surface!.session.currentPackage();
      const right = bob.surface!.session.currentPackage();
      expect(packageFingerprint(left)).toBe(packageFingerprint(right));
      expect(saveReopenDigest(left)).toEqual(saveReopenDigest(right));
      expect(validateOoxmlPart(mainPart(right)).ok).toBe(true);
      expect(paragraphProperties(alice)).toBe(race.expected);
      expect(paragraphProperties(bob)).toBe(race.expected);
    });
  }
}
