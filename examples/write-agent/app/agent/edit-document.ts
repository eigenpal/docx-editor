import type { DocxEditorRuntime, RequestContext } from '@docx-editor.dev/editor-api';
import { insertParagraphs } from './insert-paragraphs';
import * as s from './editing-schemas';
import {
  assignDefined,
  bodyFor,
  checkedParagraph,
  commit,
  paragraphMap,
  requireInspected,
  resolveTargets,
  stateFor,
  WriterError,
  type WriterState,
} from './document-access';

async function objectAt<T>(
  context: RequestContext,
  collection: { load(value: string): unknown; items: readonly T[] },
  index: number,
  state: WriterState,
  story: s.Story,
  area: string
): Promise<T> {
  requireInspected(state, story, area, index);
  collection.load('items');
  await context.sync();
  const item = collection.items[index];
  if (!item) throw new WriterError('ItemNotFound', 'The target object no longer exists.');
  return item;
}

export async function editDocument(
  runtime: DocxEditorRuntime,
  name: string,
  input: unknown
): Promise<unknown> {
  const state = stateFor(runtime);
  return runtime.run(async (context) => {
    if (name === 'format_document') {
      const data = s.formatSchema.parse(input);
      const body = await bodyFor(context, data.story);
      const targets = await resolveTargets(context, body, data.targets, state, data.story);
      for (const target of targets) {
        for (const change of data.changes) {
          const owner =
            change.property in s.font.shape
              ? target.range.font
              : change.property === 'hyperlink'
                ? target.range
                : target.paragraph;
          Object.assign(owner, { [change.property]: change.value });
        }
      }
      await commit(context, state, 'format');
      return { formatted: targets.length };
    }
    if (name === 'edit_text') {
      const data = s.textSchema.parse(input);
      const body = await bodyFor(context, data.story);
      const inserted = await insertParagraphs(context, body, data, state);
      if (inserted) return inserted;
      const targets = await resolveTargets(
        context,
        body,
        data.edits.map((e) =>
          e.action === 'deleteParagraph' ? { paragraphId: e.paragraphId } : e.target
        ),
        state,
        data.story
      );
      data.edits.forEach((edit, i) => {
        if (
          edit.action === 'insertText' &&
          edit.location === 'Replace' &&
          edit.text === (edit.target.search ?? targets[i]!.paragraph.text)
        )
          throw new WriterError(
            'InvalidArgument',
            'The replacement has unchanged text. Use format_document for formatting in either editing mode.'
          );
      });
      const written: { range: import('@docx-editor.dev/editor-api').Range; font: object }[] = [];
      const created: {
        paragraph: import('@docx-editor.dev/editor-api').Paragraph;
        style?: string;
        format?: { property: string; value: unknown }[];
      }[] = [];
      data.edits.forEach((edit, i) => {
        const { range, paragraph } = targets[i]!;
        if (edit.action === 'insertText') {
          const inserted = range.insertText(edit.text, edit.location);
          if (edit.font) written.push({ range: inserted, font: edit.font });
        } else if (edit.action === 'delete') range.delete();
        else if (edit.action === 'deleteParagraph') paragraph.delete();
        else
          created.push({
            paragraph: range.insertParagraph(edit.text, edit.location),
            style: edit.style,
            format: edit.format,
          });
      });
      await commit(context, state, 'text');
      if (written.length || created.some((c) => c.style !== undefined || c.format?.length)) {
        for (const item of written) assignDefined(item.range.font, item.font);
        for (const c of created) {
          if (c.style !== undefined) c.paragraph.style = c.style;
          for (const change of c.format ?? []) {
            const owner = change.property in s.font.shape ? c.paragraph.font : c.paragraph;
            Object.assign(owner, { [change.property]: change.value });
          }
        }
        await commit(context, state, 'inserted formatting');
      }
      return { edited: data.edits.length };
    }
    if (name === 'edit_table') {
      const data = s.tableSchema.parse(input),
        op = data.operation;
      const body = await bodyFor(context, data.story);
      const table = await objectAt(context, body.tables, data.table, state, data.story, 'tables');
      if (op.action === 'values') table.values = op.values;
      else if (op.action === 'delete') table.delete();
      else if (op.action === 'addRows') table.addRows(op.location, op.count, op.values);
      else if (op.action === 'addColumns') table.addColumns(op.location, op.count, op.values);
      else if (op.action === 'deleteRows') table.deleteRows(op.start, op.count);
      else if (op.action === 'deleteColumns') table.deleteColumns(op.start, op.count);
      else if (op.action === 'format') {
        for (const change of op.changes) Object.assign(table, { [change.property]: change.value });
      } else {
        const cell = table.getCell(op.row, op.column);
        await context.sync();
        for (const change of op.changes) Object.assign(cell, { [change.property]: change.value });
      }
      await commit(context, state, op.action);
      return { table: data.table, action: op.action };
    }
    if (name === 'edit_list') {
      const data = s.listSchema.parse(input),
        op = data.operation;
      const body = await bodyFor(context, data.story);
      const map = await paragraphMap(context, body, state, data.story);
      const paragraphs = data.paragraphIds.map((id) =>
        checkedParagraph(map, id, state, data.story)
      );
      if (new Set(data.paragraphIds).size !== data.paragraphIds.length)
        throw new WriterError('InvalidArgument', 'Choose each paragraph once.');
      if (op.action === 'create') {
        const list = paragraphs[0]!.startNewList();
        await commit(context, state, 'create list');
        list.load('id');
        await context.sync();
        if (op.kind === 'bullet') list.setLevelBullet(0, 'Solid');
        else list.setLevelNumbering(0, 'Arabic', [0, '.']);
        for (const p of paragraphs.slice(1)) p.attachToList(list.id, 0);
      } else
        for (const p of paragraphs) {
          if (op.action === 'attach') p.attachToList(op.listId, op.level);
          else if (op.action === 'detach') p.detachFromList();
          else p.listItem.level = op.level;
        }
      await commit(context, state, op.action);
      return { edited: paragraphs.length };
    }
    if (name === 'configure_list') {
      const data = s.listLevelSchema.parse(input);
      const body = await bodyFor(context, data.story);
      const list = await objectAt(context, body.lists, data.list, state, data.story, 'lists');
      for (const op of data.operations) {
        if (op.action === 'bullet')
          list.setLevelBullet(data.level, op.bullet, op.charCode, op.fontName);
        else if (op.action === 'numbering')
          list.setLevelNumbering(data.level, op.numbering, op.formatString);
        else if (op.action === 'startingNumber') list.setLevelStartingNumber(data.level, op.value);
        else list.setLevelIndents(data.level, op.textIndent, op.markerIndent);
      }
      await commit(context, state, 'configure list');
      return { list: data.list };
    }
    if (name === 'edit_control') {
      const data = s.controlSchema.parse(input),
        op = data.operation;
      const body = await bodyFor(context, data.story);
      const control = await objectAt(
        context,
        body.contentControls,
        data.control,
        state,
        data.story,
        'controls'
      );
      if (op.action === 'insertText') control.insertText(op.text, op.location);
      else if (op.action === 'delete') control.delete(op.keepContent);
      else {
        for (const change of op.changes)
          Object.assign(control, { [change.property]: change.value });
      }
      await commit(context, state, op.action);
      return { control: data.control };
    }
    if (name === 'edit_review') {
      const data = s.reviewSchema.parse(input),
        op = data.operation;
      const body = await bodyFor(context, data.story);
      if (op.action === 'comment') {
        const [target] = await resolveTargets(context, body, [op.target], state, data.story);
        target!.range.insertComment(op.text);
      } else if ('comment' in op) {
        const comment = await objectAt(
          context,
          body.getComments(),
          op.comment,
          state,
          data.story,
          'comments'
        );
        if (op.action === 'reply') comment.reply(op.text);
        else if (op.action === 'resolveComment') comment.resolved = op.resolved;
        else if (op.action === 'deleteComment') comment.delete();
        else {
          comment.replies.load('items');
          await context.sync();
          const reply = comment.replies.items[op.reply];
          if (!reply) throw new WriterError('ItemNotFound', 'The reply no longer exists.');
          reply.delete();
        }
      } else if (op.action === 'acceptAll' || op.action === 'rejectAll') {
        if (!state.inspected.has(`${JSON.stringify(data.story)}:revisions`))
          throw new WriterError('StaleDocument', 'Inspect revisions first.');
        if (op.action === 'acceptAll') body.revisions.acceptAll();
        else body.revisions.rejectAll();
      } else {
        const revision = await objectAt(
          context,
          body.revisions,
          op.revision,
          state,
          data.story,
          'revisions'
        );
        if (op.action === 'acceptRevision') revision.accept();
        else revision.reject();
      }
      await commit(context, state, op.action);
      return { action: op.action };
    }
    if (name === 'edit_layout') {
      const data = s.layoutSchema.parse(input);
      const section = await objectAt(
        context,
        context.document.sections,
        data.section,
        state,
        { kind: 'body', section: 0, variant: 'Primary' },
        'sections'
      );
      for (const change of data.changes)
        Object.assign(section.pageSetup, { [change.property]: change.value });
      await commit(context, state, 'page setup');
      return { section: data.section };
    }
    if (name === 'insert_break') {
      const data = s.breakSchema.parse(input);
      const body = await bodyFor(context, data.story);
      const [target] = await resolveTargets(context, body, [data.target], state, data.story);
      target!.range.insertBreak(data.type, data.location);
      await commit(context, state, 'break');
      return { type: data.type };
    }
    if (name === 'edit_picture') {
      const data = s.pictureSchema.parse(input),
        op = data.operation;
      const body = await bodyFor(context, data.story);
      if (op.action === 'insert') {
        const [target] = await resolveTargets(context, body, [op.target], state, data.story);
        target!.range.insertInlinePictureFromBase64(op.base64, op.location);
      } else {
        const picture = await objectAt(
          context,
          body.inlinePictures,
          op.picture,
          state,
          data.story,
          'pictures'
        );
        if (op.action === 'delete') picture.delete();
        else {
          for (const change of op.changes)
            Object.assign(picture, { [change.property]: change.value });
        }
      }
      await commit(context, state, op.action);
      return { action: op.action };
    }
    if (name === 'edit_field') {
      const data = s.fieldSchema.parse(input),
        op = data.operation;
      const body = await bodyFor(context, data.story);
      if (op.action === 'insert') {
        const [target] = await resolveTargets(context, body, [op.target], state, data.story);
        target!.range.insertField(op.location, op.type, op.switches);
      } else {
        const field = await objectAt(context, body.fields, op.field, state, data.story, 'fields');
        if (op.action === 'code') field.code = op.code;
        else if (op.action === 'delete') field.delete();
        else field.updateResult();
      }
      await commit(context, state, op.action);
      return { action: op.action };
    }
    throw new WriterError('InvalidArgument', `Unknown editing tool: ${name}`);
  });
}
