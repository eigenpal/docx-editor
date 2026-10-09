// An edit that moves many pages lays out the pages after the screen in the background.
//
// The commit publishes the pages the reader can see with the previous layout's pages after
// them, then finishes the same pass in short tasks. The oracle is a cold mount of the saved
// document: once the background pass ends, every page must match it. A second edit while the
// pass is still running drops the outdated pass and must also end on the cold layout, as must
// undo and a save in between.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type { BlockFragmentRecord } from '../../layout/semantic-records.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { setDeferredLayoutForTest } from '../surface-deferred-layout.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

function docx(): Uint8Array {
  const paragraphs: string[] = [];
  for (let index = 0; index < 900; index += 1) {
    paragraphs.push(`<w:p><w:r><w:t>Paragraph ${index}</w:t></w:r></w:p>`);
  }
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${paragraphs.join('')}<w:sectPr/></w:body></w:document>`
    ),
  });
}

/** Each page's lines as `page|text|y`, in reading order. */
function linesOf(surface: PaginatedSurface): string[] {
  const out: string[] = [];
  const visit = (blocks: readonly BlockFragmentRecord[], page: number): void => {
    for (const block of blocks) {
      if (block.kind === 'table') continue;
      for (const line of block.lines) {
        out.push(`${page}|${line.spans.map((span) => span.text).join('')}|${line.box.y}`);
      }
    }
  };
  surface.layout().pages.forEach((page, index) => visit(page.fragments, index));
  return out;
}

function mount(bytes: Uint8Array): { surface: PaginatedSurface; dispose(): void } {
  const container = document.createElement('div');
  document.body.append(container);
  const opened = mountPaginatedSurface(container, bytes);
  if (!opened.ok) throw new Error(opened.reason);
  return {
    surface: opened.surface,
    dispose() {
      opened.surface.destroy();
      container.remove();
    },
  };
}

function coldLines(surface: PaginatedSurface): string[] {
  const cold = mount(surface.session.save());
  try {
    return linesOf(cold.surface);
  } finally {
    cold.dispose();
  }
}

function splitFirst(surface: PaginatedSurface, offset = 4): void {
  const first = surface.session.paragraphIds()[0]!;
  surface.setSelection({
    anchor: { paragraphId: first, offset },
    head: { paragraphId: first, offset },
  });
  surface.splitParagraph();
}

/** Wait until the background pass publishes, then return the lines. */
async function settled(surface: PaginatedSurface, expected: string[]): Promise<string[]> {
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const lines = linesOf(surface);
    if (lines.length === expected.length && lines.join('\n') === expected.join('\n')) return lines;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return linesOf(surface);
}

describe('pages after the screen finish in the background', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => {
    restore = setDeferredLayoutForTest(1, 0);
  });
  afterEach(() => restore());

  test('an edit that moves every later page ends on the cold layout', async () => {
    const { surface, dispose } = mount(docx());
    try {
      expect(surface.layout().pages.length).toBeGreaterThan(12);
      splitFirst(surface);
      const interim = linesOf(surface);
      const cold = coldLines(surface);
      // The commit left the later pages to the background: they still show the old flow.
      expect(interim).not.toEqual(cold);
      expect(interim.slice(0, 10)).toEqual(cold.slice(0, 10));
      expect(await settled(surface, cold)).toEqual(cold);
    } finally {
      dispose();
    }
  });

  test('a second edit during the pass drops it and still ends on the cold layout', async () => {
    const { surface, dispose } = mount(docx());
    try {
      splitFirst(surface);
      splitFirst(surface, 2);
      const cold = coldLines(surface);
      expect(await settled(surface, cold)).toEqual(cold);

      surface.undo();
      surface.undo();
      const reverted = coldLines(surface);
      expect(await settled(surface, reverted)).toEqual(reverted);
    } finally {
      dispose();
    }
  });

  test('a save during the pass writes the edited document', () => {
    const { surface, dispose } = mount(docx());
    try {
      splitFirst(surface);
      const saved = mount(surface.session.save());
      try {
        expect(saved.surface.session.paragraphIds().length).toBe(901);
      } finally {
        saved.dispose();
      }
    } finally {
      dispose();
    }
  });
});
