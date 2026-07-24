// Representative DOCX fixtures for the production-editor accessibility harness (task 4.7).
// Localized labels are Spanish — no hardcoded English user-facing strings.

import { zipSync, strToU8 } from 'fflate';
import {
  createEmptyModel,
  bodyStoryId,
  DocumentStore,
  ORIGIN_IDS,
  writeDocx,
  type ParagraphRecord,
} from '@docx-editor.dev/engine-core';

const HUMAN = ORIGIN_IDS.mutationHuman;
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Localized accessible name supplied by adapters/i18n in real hosts. */
export const LOCALIZED_ACCESSIBLE_NAME = 'Documento de prueba';

/** Localized read-only atom labels keyed by block kind. */
export const LOCALIZED_ATOM_LABELS = { table: 'Tabla de solo lectura' } as const;

/** Build editable body paragraphs from ordered texts (empty string preserves an empty paragraph). */
export function createEditableFixtureWithTexts(texts: readonly string[]): Uint8Array {
  const model = createEmptyModel();
  const storyId = bodyStoryId(model);
  const store = new DocumentStore(model);
  const first = (model.stories.get(storyId)!.blocks[0] as ParagraphRecord).id;
  store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: first, text: texts[0] ?? '' }));
  for (let i = 1; i < texts.length; i += 1) {
    const r = store.transact(HUMAN, (c) => c.apply({ op: 'appendParagraph', storyId }));
    const pid = r.ok ? r.modelChange.created[0]! : first;
    store.transact(HUMAN, (c) => c.apply({ op: 'insertText', paragraphId: pid, text: texts[i]! }));
  }
  return writeDocx(store.currentModel);
}

/** Editable body paragraphs: non-empty, empty, and Unicode clusters in reading order. */
export function createEditableParagraphFixture(): Uint8Array {
  return createEditableFixtureWithTexts(['primera línea', '', 'café ñ 日本語']);
}

/** Read-only mixed body: editable paragraphs flank an unsupported table atom. */
export function createMixedReadOnlyFixture(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>` +
        '<w:p><w:r><w:t>antes</w:t></w:r></w:p>' +
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>celda</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
        '<w:p><w:r><w:t>después</w:t></w:r></w:p>' +
        '</w:body></w:document>',
    ),
  });
}
