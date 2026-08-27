/**
 * Format painter commands for the Editor facade.
 *
 * Separated from `editor.ts` so the facade file stays under the max-lines gate while the
 * painter keeps one cohesive vocabulary. Re-exported from `editor.ts`, so consumers keep
 * importing `@docx-editor.dev/core/contracts/editor`.
 */

/**
 * Word's Format Painter, as the two halves a keyboard user drives separately.
 *
 * The pair is deliberately NOT one command with a direction flag: `copyFormatting` reads
 * and `pasteFormatting` writes, so they answer `can` differently — copying is allowed on a
 * document open for viewing, and applying is not.
 */
export interface EditorFormatPainterCommands {
  /**
   * Capture the formatting at the selection (Word's Ctrl+Shift+C).
   *
   * Reads the RESOLVED cascade rather than the direct run properties, so painting from a
   * styled paragraph carries what the reader sees rather than the little the paragraph
   * happens to state itself.
   *
   * The LEVEL follows the selection, as Word's does. A range inside one paragraph captures
   * character formatting alone; a range that covers a paragraph mark — a whole paragraph, a
   * multi-paragraph selection, or a collapsed caret — captures the paragraph style and its
   * direct paragraph properties as well.
   *
   * Non-mutating: the capture lives on the editor, not in the document, and it survives
   * until the next capture or until the editor is detached.
   */
  copyFormatting: Record<never, never>;
  /**
   * Apply the captured formatting to the current selection (Word's Ctrl+Shift+V).
   *
   * Refused with `no formatting has been copied` until `copyFormatting` has run. Paragraph
   * formatting is applied only when the capture carries it; the text itself never moves.
   *
   * Paragraph borders (`w:pBdr`) and the run's character style (`w:rStyle`) are outside the
   * property vocabulary an op may name, so they are preserved on the target rather than
   * painted over — the same limit `clearFormatting` states.
   */
  pasteFormatting: Record<never, never>;
}
