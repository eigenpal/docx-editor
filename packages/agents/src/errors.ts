/**
 * Error classes for @eigenpal/docx-editor-agents
 */

export class TextNotFoundError extends Error {
  constructor(search: string, paragraphIndex?: number) {
    const location =
      paragraphIndex !== undefined ? ` in paragraph ${paragraphIndex}` : ' in document';
    super(`Text not found${location}: "${search}"`);
    this.name = 'TextNotFoundError';
  }
}

export class ChangeNotFoundError extends Error {
  constructor(id: number) {
    super(`Tracked change not found: id=${id}`);
    this.name = 'ChangeNotFoundError';
  }
}

/**
 * Thrown when accept/reject resolves a tracked change to a footnote or endnote
 * body. accept/reject operate on the document body only, and a tracked-change
 * `w:id` is unique only within its part (document.xml / footnotes.xml /
 * endnotes.xml), so a note change cannot be mutated through this reviewer yet.
 * Fails closed rather than silently no-op'ing or mis-reporting the change as
 * not-found.
 */
export class NoteChangeNotEditableError extends Error {
  constructor(id: number, noteType: 'footnote' | 'endnote', noteId: number) {
    super(
      `Tracked change id=${id} lives inside a ${noteType} (noteId=${noteId}); ` +
        `accept/reject operate on the document body only and cannot yet mutate ` +
        `${noteType} changes. Surfaced for discovery via getChanges({ include${
          noteType === 'footnote' ? 'Footnotes' : 'Endnotes'
        }: true }).`
    );
    this.name = 'NoteChangeNotEditableError';
  }
}

export class CommentNotFoundError extends Error {
  constructor(id: number) {
    super(`Comment not found: id=${id}`);
    this.name = 'CommentNotFoundError';
  }
}
