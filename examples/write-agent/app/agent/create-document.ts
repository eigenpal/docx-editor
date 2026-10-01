import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api';
import {
  createDocumentSchema,
  formatListsSchema,
  insertContentControlsSchema,
  insertTableSchema,
  writeHeaderFooterSchema,
  WRITER_TOOLS,
} from './tools';
import {
  assignDefined,
  bodyFor,
  bodyStory,
  commit,
  paragraphMap,
  resolveTargets,
  stateFor,
  storyKey,
  WriterError,
} from './document-access';
import { editDocument } from './edit-document';
import { font } from './editing-schemas';

export async function createOrInsert(
  runtime: DocxEditorRuntime,
  name: string,
  input: Record<string, unknown>,
  appendDraft = false,
  draftPreviousList = false
) {
  const state = stateFor(runtime);
  if (name === 'format_lists') {
    const { items } = formatListsSchema.parse(input);
    for (const kind of ['bullet', 'numbered'] as const) {
      const selected = items.filter((item) => item.kind === kind);
      if (selected.length)
        await editDocument(runtime, 'edit_list', {
          paragraphIds: selected.map((item) => item.paragraphId),
          operation: { action: 'create', kind },
        });
    }
    return { formatted: items.length };
  }
  return runtime.run(async (context) => {
    if (name === 'write_story') {
      const data = (
        WRITER_TOOLS.write_story.inputSchema as import('zod').ZodType<{
          story: import('./editing-schemas').Story;
          text: string;
          location: 'Start' | 'End' | 'Replace';
        }>
      ).parse(input);
      const body = await bodyFor(context, data.story);
      body.load('text');
      await context.sync();
      body.insertText(data.text, data.location);
      await commit(context, state, 'story text');
      return { story: data.story, location: data.location };
    }
    if (name === 'create_document') {
      const { blocks, title } = createDocumentSchema.parse(input);
      const body = context.document.body;
      // Pin the read revision before a whole-document write, including the first batch.
      body.load('text');
      context.document.load('changeTrackingMode');
      await context.sync();
      const suggested = context.document.changeTrackingMode !== 'Off';
      if (!appendDraft) {
        if (suggested) {
          const content = body.getRange('Content');
          await context.sync();
          content.delete();
        } else body.clear();
        await commit(context, state, 'clear body');
      }
      let anchor = appendDraft ? body.paragraphs.getLast() : body.paragraphs.getFirst();
      anchor.load('text');
      await context.sync();
      let emptyTail = (suggested && !appendDraft) || anchor.text === '';
      let previousList = draftPreviousList;
      const written: import('@docx-editor.dev/editor-api').Paragraph[] = [];
      for (const block of blocks) {
        if (block.kind === 'paragraph') {
          const text = block.runs ? '' : block.text;
          if (emptyTail) anchor.insertText(text, suggested ? 'End' : 'Replace');
          else anchor = body.insertParagraph(text, 'End');
          await commit(context, state, 'paragraph');
          written.push(anchor);
          if (previousList) {
            anchor.detachFromList();
            await commit(context, state, 'end list');
            previousList = false;
          }
          anchor.style = block.style;
          formatDraftParagraph(anchor, block.style);
          applyDraftChanges(anchor, block.format);
          await commit(context, state, 'paragraph formatting');
          for (const run of block.runs ?? []) {
            const range = anchor.insertText(run.text, 'End');
            await commit(context, state, 'inline text');
            assignDefined(range.font, draftFont(block.style));
            for (const change of block.format ?? [])
              if (change.property in font.shape)
                Object.assign(range.font, { [change.property]: change.value });
            if (run.font) assignDefined(range.font, run.font);
            await commit(context, state, 'inline formatting');
          }
          emptyTail = false;
        } else if (block.kind === 'list') {
          previousList = true;
          let listId: number | undefined;
          for (const text of block.items) {
            if (emptyTail) anchor.insertText(text, suggested ? 'End' : 'Replace');
            else anchor = body.insertParagraph(text, 'End');
            await commit(context, state, 'list paragraph');
            written.push(anchor);
            anchor.style = 'Normal';
            formatDraftParagraph(anchor, 'Normal');
            applyDraftChanges(anchor, block.format);
            await commit(context, state, 'list paragraph formatting');
            if (listId === undefined) {
              const list = anchor.startNewList();
              await commit(context, state, 'create list');
              list.load('id');
              await context.sync();
              listId = list.id;
              if (block.listType === 'bullet') list.setLevelBullet(0, 'Solid');
              else list.setLevelNumbering(0, 'Arabic', [0, '.']);
              list.setLevelIndents(0, 18, -9);
            } else anchor.attachToList(listId, 0);
            await commit(context, state, 'list formatting');
            emptyTail = false;
          }
        } else {
          if (!emptyTail) {
            anchor = body.insertParagraph('', 'End');
            await commit(context, state, 'table anchor');
          }
          if (previousList) {
            anchor.detachFromList();
            await commit(context, state, 'end list');
            previousList = false;
          }
          const range = anchor.getRange('Content');
          await context.sync();
          const table = range.insertTable(
            block.rows.length,
            block.rows[0]!.length,
            'Before',
            block.rows
          );
          await commit(context, state, 'table');
          table.headerRowCount = block.headerRowCount;
          await commit(context, state, 'table headers');
          if (block.headerFont && block.headerRowCount > 0) {
            const cells = Array.from({ length: block.headerRowCount }, (_, row) =>
              block.rows[0]!.map((_, column) => table.getCell(row, column))
            ).flat();
            await context.sync();
            const bodies = cells.map((cell) => cell.body);
            for (const body of bodies) body.load('text');
            await context.sync();
            for (const body of bodies) assignDefined(body.font, block.headerFont);
            await commit(context, state, 'table header formatting');
          }
          emptyTail = true;
        }
      }
      let paragraphs: Map<string, import('@docx-editor.dev/editor-api').Paragraph>;
      if (appendDraft) {
        // A streamed block returns its own targets. Avoid reloading the growing body.
        for (const paragraph of written) paragraph.load(['uniqueLocalId', 'text']);
        await context.sync();
        paragraphs = new Map(written.map((paragraph) => [paragraph.uniqueLocalId, paragraph]));
      } else paragraphs = await paragraphMap(context, body);
      const result = [...paragraphs].map(([id, paragraph]) => {
        state.paragraphs.set(`${storyKey(bodyStory)}:${id}`, paragraph.text);
        return { paragraphId: id, text: paragraph.text };
      });
      return { created: true, title, paragraphCount: result.length, paragraphs: result };
    }
    if (name === 'insert_table') {
      const { beforeParagraphId, rows, story, location } = insertTableSchema.parse(input);
      const body = await bodyFor(context, story);
      const [target] = await resolveTargets(
        context,
        body,
        [{ paragraphId: beforeParagraphId }],
        state,
        story
      );
      target!.range.insertTable(rows.length, rows[0]!.length, location, rows);
      await commit(context, state, 'insert table');
      return { inserted: true, rows: rows.length, columns: rows[0]!.length };
    }
    if (name === 'insert_content_controls') {
      const { fields, story } = insertContentControlsSchema.parse(input);
      const body = await bodyFor(context, story);
      await resolveTargets(context, body, fields, state, story);
      const controls = body.contentControls;
      controls.load('items');
      await context.sync();
      for (const control of controls.items) control.load('tag');
      await context.sync();
      const tags = new Set(controls.items.map((control) => control.tag));
      for (const field of fields) {
        if (tags.has(field.tag))
          throw new WriterError(
            'InvalidArgument',
            'This control tag is already used. Inspect controls and edit the existing control.'
          );
        tags.add(field.tag);
      }
      // Each wrapper changes the range topology. Resolve the next field again.
      for (const field of fields) {
        const [target] = await resolveTargets(context, body, [field], state, story);
        const control = target!.range.insertContentControl(field.type);
        await commit(context, state, 'insert control');
        control.tag = field.tag;
        control.title = field.title;
        await commit(context, state, 'control metadata');
      }
      return { inserted: fields.length };
    }
    if (name === 'write_header_footer') {
      const data = writeHeaderFooterSchema.parse(input);
      const section = context.document.sections.getFirst();
      await context.sync();
      const header = section.getHeader('Primary'),
        footer = section.getFooter('Primary');
      header.load('text');
      footer.load('text');
      await context.sync();
      header.insertText(data.header, 'Replace');
      await commit(context, state, 'header');
      footer.insertText(`${data.footerPrefix} of `, 'Replace');
      await commit(context, state, 'footer');
      const matches = footer.search(' of ', { matchCase: true });
      matches.load('items');
      await context.sync();
      if (matches.items.length !== 1)
        throw new WriterError('AmbiguousTarget', 'Use a footer prefix without " of ".');
      matches.items[0]!.insertField('Before', 'Page');
      await commit(context, state, 'page field');
      const end = footer.getRange('End');
      await context.sync();
      end.insertField('After', 'NumPages');
      await commit(context, state, 'page count');
      return { header: data.header, footer: `${data.footerPrefix}X of Y` };
    }
    throw new WriterError('InvalidArgument', `Unknown tool: ${name}`);
  });
}

function applyDraftChanges(
  paragraph: import('@docx-editor.dev/editor-api').Paragraph,
  changes: { property: string; value: unknown }[] | undefined
) {
  for (const change of changes ?? []) {
    const owner = change.property in font.shape ? paragraph.font : paragraph;
    Object.assign(owner, { [change.property]: change.value });
  }
}

/** Apply consistent draft typography without changing formatting during later edits. */
function formatDraftParagraph(
  paragraph: import('@docx-editor.dev/editor-api').Paragraph,
  style: string
) {
  const title = style === 'Title';
  const heading = style === 'Heading 1' || style === 'Heading 2';
  assignDefined(paragraph.font, draftFont(style));
  paragraph.alignment = 'Left';
  paragraph.leftIndent = 0;
  paragraph.rightIndent = 0;
  paragraph.firstLineIndent = 0;
  paragraph.spaceBefore = heading ? 12 : 0;
  paragraph.spaceAfter = title ? 16 : heading ? 6 : 8;
  paragraph.lineSpacing = title || heading ? 12 : 13.8;
}

/** Each inline run starts with the paragraph's font, rather than the preceding run's font. */
function draftFont(style: string) {
  const title = style === 'Title';
  const heading = style === 'Heading 1' || style === 'Heading 2';
  return {
    name: 'Calibri',
    size: title ? 24 : heading ? (style === 'Heading 1' ? 14 : 12) : 11,
    bold: title || heading,
    italic: style === 'Subtitle' || style === 'Quote',
    color: style === 'Subtitle' ? '#666666' : '#000000',
    underline: 'None',
    strikeThrough: false,
    subscript: false,
    superscript: false,
    highlightColor: null,
  };
}
