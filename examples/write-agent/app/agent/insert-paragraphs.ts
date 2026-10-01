import type { Body, Paragraph, RequestContext } from '@docx-editor.dev/editor-api';
import type { z } from 'zod';
import type { textSchema } from './editing-schemas';
import { font } from './editing-schemas';
import { commit, resolveTargets, storyKey, type WriterState } from './document-access';

type Input = z.infer<typeof textSchema>;

/** Commit each paragraph before using it as the next anchor. Proxies stay inside this run. */
export async function insertParagraphs(
  context: RequestContext,
  body: Body,
  input: Input,
  state: WriterState
) {
  const edits = input.edits;
  if (!edits.every((edit) => edit.action === 'insertParagraph')) return undefined;
  const targets = await resolveTargets(
    context,
    body,
    edits.map((edit) => edit.target),
    state,
    input.story
  );
  const tails = new Map<string, Paragraph>();
  const anchors: Record<string, string> = {};
  for (const [index, edit] of edits.entries()) {
    const id = edit.target.paragraphId;
    const anchor =
      edit.location === 'After'
        ? (tails.get(id) ?? targets[index]!.paragraph)
        : targets[index]!.paragraph;
    const paragraph = anchor.insertParagraph(edit.text, edit.location);
    await commit(context, state, 'insert paragraph');
    if (edit.style !== undefined) paragraph.style = edit.style;
    for (const change of edit.format ?? []) {
      Object.assign(change.property in font.shape ? paragraph.font : paragraph, {
        [change.property]: change.value,
      });
    }
    if (edit.style !== undefined || edit.format?.length)
      await commit(context, state, 'paragraph formatting');
    if (edit.location === 'After') tails.set(id, paragraph);
    paragraph.load('uniqueLocalId,text');
    await context.sync();
    if (paragraph.uniqueLocalId) {
      anchors[id] = paragraph.uniqueLocalId;
      state.paragraphs.set(`${storyKey(input.story)}:${paragraph.uniqueLocalId}`, paragraph.text);
    }
  }
  return { edited: edits.length, insertionAnchors: anchors };
}
