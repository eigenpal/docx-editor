import {
  forEachSemanticSpan,
  forEachSemanticStory,
  type BlockFragmentRecord,
  type PageRecord,
  type SemanticLayout,
} from '@docx-editor.dev/core/layout';

export interface NoteProjection {
  readonly kind: 'footnote' | 'endnote';
  readonly blocks: BlockFragmentRecord[];
}

export interface NoteStoryIndexes {
  readonly document: ReadonlyMap<string, NoteProjection>;
  readonly byPage: ReadonlyMap<PageRecord, ReadonlyMap<string, NoteProjection>>;
}

export const EMPTY_NOTE_STORIES: ReadonlyMap<string, NoteProjection> = new Map();

export function buildNoteStoryIndexes(layout: SemanticLayout): NoteStoryIndexes {
  const document = new Map<string, NoteProjection>();
  const byPage = new Map<PageRecord, Map<string, NoteProjection>>();
  const append = (
    target: Map<string, NoteProjection>,
    scopeId: string,
    story: 'footnote' | 'endnote',
    blocks: readonly BlockFragmentRecord[]
  ): void => {
    const entry = target.get(scopeId) ?? { kind: story, blocks: [] };
    entry.blocks.push(...blocks);
    target.set(scopeId, entry);
  };
  forEachSemanticStory(layout, ({ page, story, host, noteScopeId }) => {
    if (noteScopeId === null || (story !== 'footnote' && story !== 'endnote')) return;
    append(document, noteScopeId, story, host.fragments);
    let pageNotes = byPage.get(page);
    if (!pageNotes) {
      pageNotes = new Map();
      byPage.set(page, pageNotes);
    }
    append(pageNotes, noteScopeId, story, host.fragments);
  });
  return { document, byPage };
}

export function buildNoteLabels(layout: SemanticLayout): Map<string, string> {
  const labels = new Map<string, string>();
  forEachSemanticSpan(layout, ({ span, story }) => {
    // Textboxes have no linear Markdown position, so their citations must not consume labels.
    if (story === 'textbox') return;
    if (span.noteNav?.direction !== 'to-note' || labels.has(span.noteNav.scopeId)) return;
    labels.set(span.noteNav.scopeId, String(labels.size + 1));
  });
  return labels;
}
