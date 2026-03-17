/**
 * Error classes for @eigenpal/docx-editor-agent-use
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

export class CommentNotFoundError extends Error {
  constructor(id: number) {
    super(`Comment not found: id=${id}`);
    this.name = 'CommentNotFoundError';
  }
}
