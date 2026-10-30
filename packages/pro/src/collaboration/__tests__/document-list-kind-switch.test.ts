/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Switching a list item between bullets and numbers mints a definition with the old list's
// level geometry. The definition and the item's new marker replicate together, so the item
// stays in place on both replicas: through concurrent switches, edits and deletions of the
// switched item, undo and redo, and a cold reopen.
import { afterEach, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { collaborationModule } from '../collaboration-module.ts';
import { createPeerHarness, zipDocument } from './document-peer-support.ts';
import { packageFingerprint, saveReopenDigest } from './document-support.ts';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
const harness = createPeerHarness('list-kind-switch-room', { offlineEditing: true });
type Editor = ReturnType<typeof createDocxEditor>;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  harness.cleanup();
});

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// 0.25" + 0.5" per level with a 0.25" hang: not the engine's stock geometry.
const numbering = (pPr: (ilvl: number) => string): string =>
  `<w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0">` +
  Array.from(
    { length: 9 },
    (_, ilvl) =>
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/>` +
      `<w:lvlText w:val="%${ilvl + 1})"/><w:lvlJc w:val="left"/>${pPr(ilvl)}</w:lvl>`
  ).join('') +
  '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
const NUMBERING = numbering(
  (ilvl) => `<w:pPr><w:ind w:left="${360 + 720 * ilvl}" w:hanging="360"/></w:pPr>`
);
const item = (text: string, ilvl: number) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr></w:pPr>` +
  `<w:r><w:t>${text}</w:t></w:r></w:p>`;

interface Placement {
  readonly marker: string | null;
  readonly markerX: number | null;
  readonly textX: number | null;
}

function placementsOf(editor: Editor): Placement[] {
  return editor.surface!.layout().pages.flatMap((page) =>
    page.fragments.flatMap((fragment) =>
      fragment.kind === 'paragraph'
        ? [
            {
              marker: fragment.marker?.text ?? null,
              markerX: fragment.marker?.box.x ?? null,
              textX: fragment.lines[0]?.box.x ?? null,
            },
          ]
        : []
    )
  );
}

function coldPlacementsOf(editor: Editor): Placement[] {
  const cold = createDocxEditor({
    container: document.createElement('div'),
    document: editor.surface!.session.save(),
  });
  try {
    return placementsOf(cold);
  } finally {
    cold.destroy();
  }
}

// A numbering style at 1.25", over a level at 0.25": its items sit where the style says.
const LIST_NUMBER_STYLES =
  `<w:styles xmlns:w="${W}">` +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/>' +
  '<w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr>' +
  '<w:ind w:left="1800" w:hanging="360"/></w:pPr></w:style></w:styles>';

/** With `styledFirst`, the first item is numbered by the List Number style instead. */
async function pairedEditors(numberingXml = NUMBERING, styledFirst = false) {
  const first = styledFirst
    ? '<w:p><w:pPr><w:pStyle w:val="ListNumber"/></w:pPr><w:r><w:t>alpha</w:t></w:r></w:p>'
    : item('alpha', 0);
  const peers = await harness.pair(
    zipDocument(first + item('bravo', 0) + item('charlie', 3) + item('delta', 0), {
      overrides:
        '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
        (styledFirst
          ? '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          : ''),
      documentRels:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
        (styledFirst
          ? '<Relationship Id="rIdSty" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
          : '') +
        '</Relationships>',
      extraXml: {
        'word/numbering.xml': numberingXml,
        ...(styledFirst ? { 'word/styles.xml': LIST_NUMBER_STYLES } : {}),
      },
    })
  );
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
  const converged = (): Placement[] => {
    peers.alice.room.session.flushPendingJournals();
    peers.bob.room.session.flushPendingJournals();
    const left = alice.surface!.session.currentPackage();
    const right = bob.surface!.session.currentPackage();
    expect(packageFingerprint(right)).toBe(packageFingerprint(left));
    expect(saveReopenDigest(right)).toEqual(saveReopenDigest(left));
    expect(placementsOf(bob)).toEqual(placementsOf(alice));
    for (const editor of [alice, bob])
      expect(placementsOf(editor)).toEqual(coldPlacementsOf(editor));
    return placementsOf(alice);
  };
  return { alice, bob, converged, pause: peers.pause, resume: peers.resume };
}

const caret = (editor: Editor, index: number, offset = 1) => {
  const paragraphId = editor.surface!.session.paragraphIds()[index]!;
  editor.surface!.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
};

const BULLET = '•';
const markers = (placements: readonly Placement[]) => placements.map((entry) => entry.marker);
const positions = (placements: readonly Placement[]) =>
  placements.map(({ markerX, textX }) => ({ markerX, textX }));

test('two peers switching different items at once keep both in place', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  const before = positions(converged());

  pause();
  caret(alice, 1);
  expect(alice.surface!.toggleList('bullet')).toBe(true);
  caret(bob, 2);
  expect(bob.surface!.toggleList('bullet')).toBe(true);
  resume();
  const switched = converged();
  expect(markers(switched)).toEqual(['1)', BULLET, BULLET, '2)']);
  expect(positions(switched)).toEqual(before);

  alice.surface!.undo();
  expect(markers(converged())).toEqual(['1)', '2)', BULLET, '3)']);
  alice.surface!.redo();
  expect(positions(converged())).toEqual(before);
  expect(markers(converged())).toEqual(['1)', BULLET, BULLET, '2)']);
});

test('a switch converges while the peer types in and then deletes that item', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors();
  const before = positions(converged());

  pause();
  caret(alice, 2);
  expect(alice.surface!.toggleList('bullet')).toBe(true);
  caret(bob, 2, 0);
  bob.surface!.insertPlainText('x');
  resume();
  const switched = converged();
  expect(markers(switched)[2]).toBe(BULLET);
  expect(positions(switched)).toEqual(before);

  pause();
  caret(alice, 2);
  expect(alice.surface!.toggleList('ordered')).toBe(true);
  const ids = bob.surface!.session.paragraphIds();
  bob.surface!.setSelection({
    anchor: { paragraphId: ids[1]!, offset: 5 },
    head: { paragraphId: ids[2]!, offset: 8 },
  });
  bob.surface!.deleteSelection();
  resume();
  const settled = converged();
  expect(settled.every((entry) => entry.marker !== null)).toBe(true);
});

test('a peer switching the item back rejoins the list where it stood', async () => {
  const { alice, bob, converged } = await pairedEditors();
  const before = positions(converged());

  caret(alice, 1);
  expect(alice.surface!.toggleList('bullet')).toBe(true);
  expect(positions(converged())).toEqual(before);
  caret(bob, 1);
  expect(bob.surface!.toggleList('ordered')).toBe(true);
  const back = converged();
  expect(markers(back)).toEqual(['1)', '2)', '1)', '3)']);
  expect(positions(back)).toEqual(before);
});

test('carried level tabs and spacing replicate with concurrent switches', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors(
    numbering(
      (ilvl) =>
        `<w:pPr><w:tabs><w:tab w:val="num" w:pos="${1080 + 720 * ilvl}"/></w:tabs>` +
        `<w:spacing w:after="120"/><w:ind w:left="${1440 + 720 * ilvl}" w:hanging="720"/></w:pPr>`
    )
  );
  const before = positions(converged());

  pause();
  caret(alice, 1);
  expect(alice.surface!.toggleList('bullet')).toBe(true);
  caret(bob, 3);
  expect(bob.surface!.toggleList('bullet')).toBe(true);
  resume();
  const switched = converged();
  expect(markers(switched)).toEqual(['1)', BULLET, '1)', BULLET]);
  expect(positions(switched)).toEqual(before);

  bob.surface!.undo();
  expect(markers(converged())).toEqual(['1)', BULLET, '1)', '2)']);
});

test('one press that mints two definitions converges with a concurrent switch', async () => {
  const { alice, bob, converged, pause, resume } = await pairedEditors(NUMBERING, true);
  const before = positions(converged());

  // The styled item and a plain one switch together: each keeps its own place.
  pause();
  const ids = alice.surface!.session.paragraphIds();
  alice.surface!.setSelection({
    anchor: { paragraphId: ids[0]!, offset: 0 },
    head: { paragraphId: ids[1]!, offset: 2 },
  });
  expect(alice.surface!.toggleList('bullet')).toBe(true);
  caret(bob, 3);
  expect(bob.surface!.toggleList('bullet')).toBe(true);
  resume();
  const switched = converged();
  expect(markers(switched)).toEqual([BULLET, BULLET, '1)', BULLET]);
  expect(positions(switched)).toEqual(before);

  alice.surface!.undo();
  expect(positions(converged())).toEqual(before);
  alice.surface!.redo();
  expect(positions(converged())).toEqual(before);
});
