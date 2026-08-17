// Which card is OPEN, when two cards cover the same characters.
//
// Activation round-trips through the caret: `setActiveReviewItem` installs a selection over the
// item and the surface classifies that position back into a card. The round trip is lossy the
// moment two cards cover one span, and OOXML writes that shape routinely — `w:ins` wrapping
// `w:del` is content one reviewer added and another struck, and the insertion and the deletion
// carry one identical range. Every click on either card came back as whichever the queue listed
// first, so one of the two was unreachable and the reader watched the wrong card light up.
//
// The second half is neighbouring ranges. Tracked edits meet end-to-start by construction, and
// a range that merely ENDS at the caret used to outrank the range that contains it whenever the
// toucher was narrower — which a one-character insertion beside a six-character one always is.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../index.ts';
import type { EditorModule } from '../../contracts/modules.ts';
import { collectReviewItems } from '../../store/index.ts';

/**
 * The engine's OWN queue behind a review contribution, which is what gates it.
 *
 * `stubReviewModule` derives nothing, and the seam tests beside it do not need it to. This one
 * does: the question here is which of several real cards a click resolves to, so the cards have
 * to be real. The derivation is the store's, not pro's — pro adds custom-node cards on top and
 * core must not depend on it even in a test.
 */
function engineReviewModule(): EditorModule {
  return {
    id: 'review',
    review: {
      displayModes: ['all-markup', 'proposed', 'original'],
      collectReviewItems,
      revisionItemsOfParagraph: () => [],
    },
  };
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

function mount(body: string): DocxEditorInstance {
  const container = document.createElement('div');
  const editor = createDocxEditor({
    container,
    document: docx(body),
    author: 'Grace Hopper',
    modules: [engineReviewModule()],
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  return editor;
}

/**
 * A paragraph of interleaved tracked changes, as a real reviewed contract carries them.
 *
 * `w:id=3` and `w:id=5` each wrap a deletion inside an insertion: A added the words, B struck
 * them. Both halves stay pending, so both are cards, and their ranges are identical. The tail
 * insertions meet the nested pair end-to-start.
 */
const NESTED = `<w:p>
<w:r><w:t>This</w:t></w:r>
<w:r><w:t xml:space="preserve"> is a</w:t></w:r>
<w:del w:author="A" w:date="2026-07-08T11:32:00Z" w:id="1"><w:r><w:delText>n original paragraph</w:delText></w:r></w:del>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="2"><w:r><w:t xml:space="preserve"> </w:t></w:r></w:ins>
<w:ins w:author="B" w:date="2026-07-08T09:33:37Z" w:id="3"><w:del w:author="C" w:date="2026-08-10T14:34:17Z" w:id="4"><w:r><w:delText>nested</w:delText></w:r></w:del></w:ins>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="5"><w:del w:author="B" w:date="2026-07-08T09:33:36Z" w:id="6"><w:r><w:delText>tracked</w:delText></w:r></w:del></w:ins>
<w:ins w:author="C" w:date="2026-08-10T14:34:17Z" w:id="7"><w:r><w:t>lorem ipsum</w:t></w:r></w:ins>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="8"><w:r><w:t xml:space="preserve"> </w:t></w:r></w:ins>
<w:ins w:author="A" w:date="2026-07-08T11:32:00Z" w:id="9"><w:r><w:t>change</w:t></w:r></w:ins>
</w:p>`;

function activeKey(editor: DocxEditorInstance): string | null {
  return editor.getReviewItems().find((entry) => entry.isActive)?.key ?? null;
}

describe('overlapping review cards', () => {
  test('the queue holds both halves of every nested change', () => {
    const editor = mount(NESTED);
    const cards = editor.getReviewItems();
    // Two identical ranges for each nested pair: the wrapper insertion and the deletion in it.
    const spans = cards
      .filter((card) => card.kind === 'revision')
      .map((card) =>
        (
          card.item as { ranges: readonly { start: { offset: number }; end: { offset: number } }[] }
        ).ranges
          .map((range) => `${range.start.offset}-${range.end.offset}`)
          .join(',')
      );
    expect(spans.filter((span) => span === '30-36')).toHaveLength(2);
    expect(spans.filter((span) => span === '36-43')).toHaveLength(2);
    editor.destroy();
  });

  test('every card activates ITSELF, including two on one span', () => {
    const editor = mount(NESTED);
    const keys = editor
      .getReviewItems()
      .filter((card) => card.activatable)
      .map((card) => card.key);
    expect(keys.length).toBeGreaterThan(4);
    for (const key of keys) {
      expect(editor.setActiveReviewItem(key).ok).toBe(true);
      // Was: the caret reclassified to whichever card the queue listed first, so five of the
      // seven cards in this paragraph opened one of their neighbours instead of themselves.
      expect(activeKey(editor)).toBe(key);
    }
    editor.destroy();
  });

  test('activation gives the answer back to the caret once the reader moves it', () => {
    const editor = mount(NESTED);
    const cards = editor.getReviewItems().filter((card) => card.activatable);
    const last = cards[cards.length - 1]!;
    expect(editor.setActiveReviewItem(last.key).ok).toBe(true);
    expect(activeKey(editor)).toBe(last.key);

    // Clicking away from the change closes its card. A pin that outlived its own selection
    // would have held the card open over text it does not cover.
    const paragraphId = (last.item as { ranges: readonly { start: { paragraphId: string } }[] })
      .ranges[0]!.start.paragraphId;
    editor.exec({
      type: 'setSelection',
      range: { anchor: { paragraphId, offset: 0 }, head: { paragraphId, offset: 0 } },
    });
    expect(activeKey(editor)).toBe(null);
    editor.destroy();
  });

  test('a caret inside a range beats a neighbour that only ends there', () => {
    const editor = mount(NESTED);
    const cards = editor.getReviewItems();
    const paragraphId = (
      cards[0]!.item as { ranges: readonly { start: { paragraphId: string } }[] }
    ).ranges[0]!.start.paragraphId;
    // Offset 30 is where the nested pair STARTS and where the replacement before it ENDS.
    editor.exec({
      type: 'setSelection',
      range: { anchor: { paragraphId, offset: 30 }, head: { paragraphId, offset: 30 } },
    });
    const open = editor.getReviewItems().find((entry) => entry.isActive);
    expect(open).toBeDefined();
    // Was: the replacement's second range is one character wide and ends at 30, so it won on
    // width and claimed every click on the six characters that start there.
    const ranges = (
      open!.item as { ranges: readonly { start: { offset: number }; end: { offset: number } }[] }
    ).ranges;
    expect(ranges[0]!.start.offset).toBe(30);
    expect(ranges[0]!.end.offset).toBe(36);
    editor.destroy();
  });
});
