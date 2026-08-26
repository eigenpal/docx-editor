// A drawing inside a tracked insertion or deletion carries the change (#479).
//
// The record folds the owning run's revision stack in, paint marks the element with the
// same `data-revision-*` datasets spans carry plus a kind-coloured outline class, deleted
// pictures stay laid out under `all-markup` (dimmed, like struck text), and the resolved
// display modes remove what they resolve away — inline and anchored alike.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import type { SurfaceEditingMode } from '../paginated-surface-contract.ts';
import type { RevisionDisplayMode } from '../../layout/revision-projection.ts';
import type { InlineDrawingRecord } from '../../layout/drawing-layout.ts';
import { revisionItemsOf } from '../../store/store/review-reads.ts';
import {
  CT_NS,
  DRAWING_NS,
  IMG_REL,
  OD_REL,
  PNG_1X1,
  REL_NS,
  decodePort,
  inlinePicture,
  picture,
  settle,
} from './image-decode-harness.ts';

/** An anchored picture at the paragraph's top-left corner, wrapping nothing. */
function anchoredPicture(id: number): string {
  return (
    '<w:r><w:drawing>' +
    '<wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" behindDoc="0" locked="0" ' +
    'layoutInCell="1" allowOverlap="1" relativeHeight="1">' +
    '<wp:simplePos x="0" y="0"/>' +
    '<wp:positionH relativeFrom="column"><wp:posOffset>0</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>' +
    `<wp:extent cx="457200" cy="457200"/><wp:wrapNone/><wp:docPr id="${id}" name="pic"/>` +
    `${picture(id)}</wp:anchor></w:drawing></w:r>`
  );
}

const ins = (inner: string): string =>
  `<w:ins w:id="11" w:author="Alice" w:date="2024-01-01T00:00:00Z">${inner}</w:ins>`;
const del = (inner: string): string =>
  `<w:del w:id="12" w:author="Bob" w:date="2024-01-02T00:00:00Z">${inner}</w:del>`;

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT_NS}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL_NS}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/></Relationships>`
    ),
    'word/media/image1.png': PNG_1X1,
    'word/document.xml': strToU8(`<w:document ${DRAWING_NS}><w:body>${body}</w:body></w:document>`),
  });
}

async function mount(
  bytes: Uint8Array,
  revisionDisplayMode?: RevisionDisplayMode,
  extra?: { readonly author?: string; readonly editingMode?: SurfaceEditingMode }
): Promise<{ surface: PaginatedSurface; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes, {
    scale: 1,
    imageDecodePort: decodePort(),
    ...(revisionDisplayMode ? { revisionDisplayMode } : {}),
    ...(extra?.author ? { author: extra.author } : {}),
    ...(extra?.editingMode ? { editingMode: extra.editingMode } : {}),
  });
  if (!opened.ok) throw new Error(opened.reason);
  await settle();
  return { surface: opened.surface, container };
}

function lineDrawings(surface: PaginatedSurface): readonly InlineDrawingRecord[] {
  return surface
    .layout()
    .pages.flatMap((page) => page.fragments)
    .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []))
    .flatMap((line) => line.drawings ?? []);
}

describe('tracked drawings carry and paint their revision', () => {
  test('an inserted inline picture is outlined, attributed, and gets a change bar', async () => {
    const { surface, container } = await mount(
      docx(`<w:p><w:r><w:t xml:space="preserve">before </w:t></w:r>${ins(inlinePicture(5))}</w:p>`)
    );
    try {
      const drawings = lineDrawings(surface);
      expect(drawings).toHaveLength(1);
      expect(drawings[0]!.revisions).toEqual([
        {
          kind: 'insert',
          id: '11',
          author: 'Alice',
          date: '2024-01-01T00:00:00Z',
          nodeId: expect.any(String),
        },
      ]);

      const element = container.querySelector<HTMLElement>('.docx-drawing');
      expect(element).not.toBeNull();
      expect(element!.classList.contains('docx-drawing--revision')).toBe(true);
      expect(element!.classList.contains('docx-drawing--revision-insertion')).toBe(true);
      expect(element!.dataset.revisionKind).toBe('insert');
      expect(element!.dataset.revisionId).toBe('11');
      expect(element!.dataset.reviewAuthor).toBe('Alice');

      // The line's only change is the picture — no revision span — and the margin still says
      // something changed on it.
      expect(container.querySelector('.docx-change-bar-insertion')).not.toBeNull();
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a deleted inline picture stays laid out under all-markup, marked as a removal', async () => {
    const { surface, container } = await mount(
      docx(`<w:p><w:r><w:t xml:space="preserve">keep </w:t></w:r>${del(inlinePicture(6))}</w:p>`)
    );
    try {
      const drawings = lineDrawings(surface);
      expect(drawings).toHaveLength(1);
      expect(drawings[0]!.revisions![0]!.kind).toBe('delete');

      const element = container.querySelector<HTMLElement>('.docx-drawing');
      expect(element).not.toBeNull();
      expect(element!.classList.contains('docx-drawing--revision-deletion')).toBe(true);
      expect(element!.dataset.revisionKind).toBe('delete');
      expect(element!.dataset.reviewAuthor).toBe('Bob');
      expect(container.querySelector('.docx-change-bar-deletion')).not.toBeNull();
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('the proposed result drops a deleted picture; the original drops an inserted one', async () => {
    const body =
      `<w:p><w:r><w:t xml:space="preserve">text </w:t></w:r>${del(inlinePicture(6))}</w:p>` +
      `<w:p>${ins(inlinePicture(7))}</w:p>`;
    const proposed = await mount(docx(body), 'proposed');
    try {
      const drawings = lineDrawings(proposed.surface);
      expect(drawings).toHaveLength(1);
      expect(drawings[0]!.revisions![0]!.kind).toBe('insert');
    } finally {
      proposed.surface.destroy();
      proposed.container.remove();
    }
    const original = await mount(docx(body), 'original');
    try {
      const drawings = lineDrawings(original.surface);
      expect(drawings).toHaveLength(1);
      expect(drawings[0]!.revisions![0]!.kind).toBe('delete');
    } finally {
      original.surface.destroy();
      original.container.remove();
    }
  });

  test('an untracked picture paints no revision marking', async () => {
    const { surface, container } = await mount(docx(`<w:p>${inlinePicture(8)}</w:p>`));
    try {
      expect(lineDrawings(surface)[0]!.revisions).toBeUndefined();
      const element = container.querySelector<HTMLElement>('.docx-drawing');
      expect(element).not.toBeNull();
      expect(element!.classList.contains('docx-drawing--revision')).toBe(false);
      expect(element!.dataset.revisionKind).toBeUndefined();
      expect(container.querySelector('.docx-change-bar')).toBeNull();
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('an inserted anchored picture is published with its revision and marked in paint', async () => {
    const { surface, container } = await mount(
      docx(
        `<w:p><w:r><w:t xml:space="preserve">anchor line</w:t></w:r>${ins(anchoredPicture(9))}</w:p>`
      )
    );
    try {
      const anchored = surface.layout().pages[0]!.anchoredDrawings ?? [];
      expect(anchored).toHaveLength(1);
      expect(anchored[0]!.revisions![0]).toMatchObject({
        kind: 'insert',
        id: '11',
        author: 'Alice',
      });

      const element = container.querySelector<HTMLElement>('.docx-drawing-layer .docx-drawing');
      expect(element).not.toBeNull();
      expect(element!.classList.contains('docx-drawing--revision-insertion')).toBe(true);
      expect(element!.dataset.revisionKind).toBe('insert');

      // The anchor line carries no span or line drawing for the picture, so the bar reads
      // the line's own anchor attribution.
      expect(container.querySelector('.docx-change-bar-insertion')).not.toBeNull();
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('a tracked anchored picture in a table cell cues a change bar too', async () => {
    const { surface, container } = await mount(
      docx(
        '<w:tbl><w:tblGrid><w:gridCol w:w="4800"/></w:tblGrid><w:tr><w:tc>' +
          `<w:p><w:r><w:t xml:space="preserve">cell text</w:t></w:r>${ins(anchoredPicture(9))}</w:p>` +
          '</w:tc></w:tr></w:tbl><w:p><w:r><w:t>after</w:t></w:r></w:p>'
      )
    );
    try {
      const cellLines = surface
        .layout()
        .pages[0]!.fragments.flatMap((block) => (block.kind === 'table' ? block.rows : []))
        .flatMap((row) => row.cells)
        .flatMap((cell) => cell.blocks)
        .flatMap((block) => (block.kind === 'paragraph' ? block.lines : []));
      expect(cellLines.some((line) => (line.anchorRevisions ?? []).length > 0)).toBe(true);
      expect(container.querySelector('.docx-change-bar-insertion')).not.toBeNull();
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('suggesting deleteImage proposes the deletion, not a paragraph break', async () => {
    const { surface, container } = await mount(
      docx(
        `<w:p>${inlinePicture(6)}</w:p><w:p><w:r><w:t xml:space="preserve">after</w:t></w:r></w:p>`
      ),
      undefined,
      { author: 'Demo Reviewer', editingMode: 'suggest' }
    );
    try {
      const target = lineDrawings(surface)[0]!;
      const result = surface.deleteImage(target.drawingNodeId);
      expect(result.ok).toBe(true);

      // The picture stays on the page as a pending removal.
      const after = lineDrawings(surface);
      expect(after).toHaveLength(1);
      expect(after[0]!.revisions![0]).toMatchObject({ kind: 'delete', author: 'Demo Reviewer' });
      const element = container.querySelector<HTMLElement>('.docx-drawing');
      expect(element!.classList.contains('docx-drawing--revision-deletion')).toBe(true);
      expect(container.querySelector('.docx-change-bar-deletion')).not.toBeNull();

      // The review queue offers the deletion itself — NOT a "deleted paragraph break" card.
      const items = revisionItemsOf(surface.session.part());
      expect(items).toHaveLength(1);
      expect(items[0]!.revisionKind).toBe('delete');
      expect(items[0]!.markDirection).toBeUndefined();
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('suggesting deleteImage without an author is refused', async () => {
    const { surface, container } = await mount(docx(`<w:p>${inlinePicture(6)}</w:p>`), undefined, {
      editingMode: 'suggest',
    });
    try {
      const target = lineDrawings(surface)[0]!;
      const result = surface.deleteImage(target.drawingNodeId);
      expect(result.ok).toBe(false);
      expect(lineDrawings(surface)).toHaveLength(1);
      expect(lineDrawings(surface)[0]!.revisions).toBeUndefined();
    } finally {
      surface.destroy();
      container.remove();
    }
  });

  test('the original view drops an inserted anchored picture, its bar, and its wrap hole', async () => {
    const topAndBottom = anchoredPicture(9).replace('<wp:wrapNone/>', '<wp:wrapTopAndBottom/>');
    const body = (drawing: string): Uint8Array =>
      docx(`<w:p>${drawing}<w:r><w:t xml:space="preserve">anchor line</w:t></w:r></w:p>`);
    const firstLineY = async (
      bytes: Uint8Array,
      mode?: RevisionDisplayMode
    ): Promise<{ y: number; bars: number; drawings: number }> => {
      const { surface, container } = await mount(bytes, mode);
      try {
        const line = surface
          .layout()
          .pages[0]!.fragments.flatMap((block) =>
            block.kind === 'paragraph' ? block.lines : []
          )[0]!;
        return {
          y: line.box.y,
          bars: container.querySelectorAll('.docx-change-bar').length,
          drawings: (surface.layout().pages[0]!.anchoredDrawings ?? []).length,
        };
      } finally {
        surface.destroy();
        container.remove();
      }
    };
    const markup = await firstLineY(body(ins(topAndBottom)));
    const original = await firstLineY(body(ins(topAndBottom)), 'original');
    const plain = await firstLineY(body(''));
    // Under all-markup the inserted picture shows: it pushes the text down and draws a bar.
    expect(markup.drawings).toBe(1);
    expect(markup.y).toBeGreaterThan(plain.y);
    expect(markup.bars).toBeGreaterThan(0);
    // The original view promises the document before the insertion: no record, no bar, and
    // no phantom text-wrap hole where the hidden picture would sit.
    expect(original.drawings).toBe(0);
    expect(original.bars).toBe(0);
    expect(original.y).toBe(plain.y);
  });
});
