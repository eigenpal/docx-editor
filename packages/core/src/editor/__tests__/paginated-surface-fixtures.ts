// Shared fixtures for the paginated-surface suites.
//
// The suites split by concern — editing and interaction in `paginated-surface.test.ts`,
// layout, materialization and measurement in `paginated-surface-layout.test.ts` — but they
// open the same documents through the same door. The package builder and the mount helper
// live here so both read a `.docx` the one way the surface is actually given one, and so a
// fixture change cannot drift between them.
//
// Nothing here touches the DOM at module scope: each suite registers happy-dom itself, and
// these helpers only reach for `document` once a test calls them.

import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { readOoxmlPackage } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';

export function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

export const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

/**
 * Put the caret at a model position in the first paragraph.
 *
 * Addresses the MODEL, not the screen. Positioning by coordinates went through the surface's
 * own hit test, which no production path uses any more — the browser resolves pointer
 * positions over the painted text. `hitTestSemantic` keeps its own tests in `engine-layout`,
 * where the page-relative contract that makes it tricky actually lives.
 */
export function putCaret(surface: PaginatedSurface, offset: number, paragraphIndex = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

export function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

export function openLayout(bytes: Uint8Array): {
  readonly layout: ReturnType<typeof layoutSemanticDocument>;
} {
  const loaded = readOoxmlPackage(bytes);
  if (!loaded.ok) throw new Error(loaded.reason);
  const part = loaded.package.parts.get(loaded.package.mainDocumentPart)!;
  return {
    layout: layoutSemanticDocument(part, 0, { measurer: createFixedMeasurer() }),
  };
}
