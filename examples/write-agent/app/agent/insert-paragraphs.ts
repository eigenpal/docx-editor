import type { Body, Paragraph, RequestContext } from '@docx-editor.dev/editor-api';
import type { z } from 'zod';
import type { textSchema } from './editing-schemas';
import { font } from './editing-schemas';
import {
  assignDefined,
  commit,
  paragraphMap,
  resolveTargets,
  storyKey,
  WriterError,
  type WriterState,
} from './document-access';

type Input = z.infer<typeof textSchema>;

/** Preserve request order across paragraph insertions and other text edits. */
export async function insertParagraphs(
  context: RequestContext,
  body: Body,
  input: Input,
  state: WriterState
) {
  const edits = input.edits;
  const targetIds = edits.map((edit) =>
    edit.action === 'deleteParagraph' ? edit.paragraphId : edit.target.paragraphId
  );
  if (
    !edits.some((edit) => edit.action === 'insertParagraph' || edit.action === 'deleteParagraph') &&
    new Set(targetIds).size === targetIds.length
  )
    return undefined;
  const targets = await resolveTargets(
    context,
    body,
    edits.map((edit) =>
      edit.action === 'deleteParagraph' ? { paragraphId: edit.paragraphId } : edit.target
    ),
    state,
    input.story
  );
  const deletions = edits.flatMap((edit, index) =>
    edit.action === 'deleteParagraph'
      ? [{ id: edit.paragraphId, paragraph: targets[index]!.paragraph }]
      : []
  );
  const imported = state.transientTargets.size
    ? new Map(
        [...(await paragraphMap(context, body, state, input.story))].filter(([id, paragraph]) => {
          if (!id.startsWith('@writer:')) return false;
          return deletions.every((deletion) => {
            if (id === deletion.id) return false;
            if (paragraph.uniqueLocalId || deletion.paragraph.uniqueLocalId)
              return paragraph.uniqueLocalId !== deletion.paragraph.uniqueLocalId;
            // Distinct indexes within one public collection identify distinct
            // paragraphs. Overlapping collection views need a fresh inspection.
            const location = state.transientTargets.get(id)?.locator;
            const deletedLocation = state.transientTargets.get(deletion.id)?.locator;
            return (
              location &&
              deletedLocation &&
              location.kind === deletedLocation.kind &&
              JSON.stringify(location) !== JSON.stringify(deletedLocation)
            );
          });
        })
      )
    : new Map<string, Paragraph>();
  const tails = new Map<string, Paragraph>();
  const anchors: Record<string, string> = {};
  const deleted = new Set<string>();
  for (const [index, edit] of edits.entries()) {
    const id = edit.action === 'deleteParagraph' ? edit.paragraphId : edit.target.paragraphId;
    if (deleted.has(id))
      throw new WriterError(
        'ItemNotFound',
        'An earlier edit deleted this paragraph. Inspect again.'
      );
    const target = targets[index]!.paragraph;
    if (edit.action !== 'insertParagraph') {
      // Resolve each range after earlier writes. Original paragraph proxies remain
      // within this run, including imported paragraphs without permanent IDs.
      let range = target.getRange('Content');
      await context.sync();
      if (edit.action !== 'deleteParagraph' && edit.target.search) {
        const matches = range.search(edit.target.search, { matchCase: true });
        matches.load('items');
        await context.sync();
        if (matches.items.length !== 1)
          throw new WriterError(
            'AmbiguousTarget',
            'The exact phrase must match once in the paragraph.'
          );
        range = matches.items[0]!;
      }
      if (edit.action === 'insertText') {
        target.load('text');
        await context.sync();
        if (edit.location === 'Replace' && edit.text === (edit.target.search ?? target.text))
          throw new WriterError(
            'InvalidArgument',
            'The replacement has unchanged text. Use format_document for formatting in either editing mode.'
          );
        const written = range.insertText(edit.text, edit.location);
        await commit(context, state, 'text');
        if (edit.font) {
          assignDefined(written.font, edit.font);
          await commit(context, state, 'inserted formatting');
        }
      } else {
        if (edit.action === 'deleteParagraph') target.delete();
        else range.delete();
        await commit(context, state, 'text');
      }
      if (edit.action === 'deleteParagraph') deleted.add(id);
      else {
        target.load('text');
        await context.sync();
        state.paragraphs.set(`${storyKey(input.story)}:${id}`, target.text);
      }
      continue;
    }
    const key = `${id}:${edit.location}`;
    const tail = tails.get(key);
    const paragraph = (tail ?? target).insertParagraph(edit.text, tail ? 'After' : edit.location);
    await commit(context, state, 'insert paragraph');
    if (edit.style !== undefined) paragraph.style = edit.style;
    for (const change of edit.format ?? []) {
      Object.assign(change.property in font.shape ? paragraph.font : paragraph, {
        [change.property]: change.value,
      });
    }
    if (edit.style !== undefined || edit.format?.length)
      await commit(context, state, 'paragraph formatting');
    tails.set(key, paragraph);
    paragraph.load('uniqueLocalId,text');
    await context.sync();
    if (paragraph.uniqueLocalId) {
      anchors[id] = paragraph.uniqueLocalId;
      state.paragraphs.set(`${storyKey(input.story)}:${paragraph.uniqueLocalId}`, paragraph.text);
    }
  }
  // A write can assign permanent paragraph IDs to imported stories. Return
  // public IDs for original targets before application inspection tokens expire.
  const paragraphTargets: Record<string, string> = {};
  for (const [index, edit] of edits.entries()) {
    const id = edit.action === 'deleteParagraph' ? edit.paragraphId : edit.target.paragraphId;
    if (!deleted.has(id)) targets[index]!.paragraph.load('uniqueLocalId,text');
  }
  for (const paragraph of imported.values()) paragraph.load('uniqueLocalId,text');
  await context.sync();
  for (const [id, paragraph] of imported) {
    if (paragraph.uniqueLocalId) {
      paragraphTargets[id] = paragraph.uniqueLocalId;
      state.paragraphs.set(`${storyKey(input.story)}:${paragraph.uniqueLocalId}`, paragraph.text);
    }
  }
  for (const [index, edit] of edits.entries()) {
    const id = edit.action === 'deleteParagraph' ? edit.paragraphId : edit.target.paragraphId;
    if (deleted.has(id)) continue;
    const paragraph = targets[index]!.paragraph;
    if (paragraph.uniqueLocalId) {
      paragraphTargets[id] = paragraph.uniqueLocalId;
      state.paragraphs.set(`${storyKey(input.story)}:${paragraph.uniqueLocalId}`, paragraph.text);
    }
  }
  return { edited: edits.length, insertionAnchors: anchors, paragraphTargets };
}
