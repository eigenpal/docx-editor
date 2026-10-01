import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api';
import { inspectSchema } from './editing-schemas';
import { bodyFor, stateFor, storyKey, rememberParagraph } from './document-access';

export async function inspectDocument(runtime: DocxEditorRuntime, input: unknown) {
  const { story, area, offset, limit } = inspectSchema.parse(input);
  const state = stateFor(runtime);
  return runtime.run(async (context) => {
    const body = await bodyFor(context, story);
    context.document.load('changeTrackingMode');
    const collection =
      area === 'paragraphs'
        ? body.paragraphs
        : area === 'tables'
          ? body.tables
          : area === 'controls'
            ? body.contentControls
            : area === 'lists'
              ? body.lists
              : area === 'comments'
                ? body.getComments()
                : area === 'revisions'
                  ? body.revisions
                  : area === 'sections'
                    ? context.document.sections
                    : area === 'pictures'
                      ? body.inlinePictures
                      : body.fields;
    collection.load('items');
    await context.sync();
    const items = collection.items.slice(offset, offset + limit);
    // Each branch narrows its collection before selecting explicit load properties.
    let records: unknown[] = [];
    if (area === 'paragraphs') {
      const ps = body.paragraphs.items.slice(offset, offset + limit);
      for (const p of ps) {
        p.load([
          'uniqueLocalId',
          'text',
          'style',
          'alignment',
          'leftIndent',
          'rightIndent',
          'firstLineIndent',
          'lineSpacing',
          'spaceBefore',
          'spaceAfter',
        ]);
        p.font.load([
          'bold',
          'italic',
          'underline',
          'name',
          'size',
          'color',
          'strikeThrough',
          'highlightColor',
          'subscript',
          'superscript',
        ]);
      }
      await context.sync();
      records = ps.map((p, index) => {
        const id = rememberParagraph(state, story, p, { kind: 'paragraph', index: offset + index });
        return {
          id,
          text: p.text,
          style: p.style,
          alignment: p.alignment,
          leftIndent: p.leftIndent,
          rightIndent: p.rightIndent,
          firstLineIndent: p.firstLineIndent,
          lineSpacing: p.lineSpacing,
          spaceBefore: p.spaceBefore,
          spaceAfter: p.spaceAfter,
          font: {
            bold: p.font.bold,
            italic: p.font.italic,
            underline: p.font.underline,
            name: p.font.name,
            size: p.font.size,
            color: p.font.color,
            strikeThrough: p.font.strikeThrough,
            highlightColor: p.font.highlightColor,
            subscript: p.font.subscript,
            superscript: p.font.superscript,
          },
        };
      });
    } else if (area === 'tables') {
      const ts = body.tables.items.slice(offset, offset + limit);
      for (const t of ts) t.load(['values', 'rowCount', 'columnCount', 'style', 'headerRowCount']);
      await context.sync();
      // Include bounded cell targets so text formatting can follow the same table inspection.
      let remainingCells = 200;
      const targets = ts.map((table) => {
        const cells = [];
        for (let row = 0; row < table.rowCount && remainingCells > 0; row++) {
          for (
            let column = 0;
            column < (table.values[row]?.length ?? 0) && remainingCells > 0;
            column++
          ) {
            const paragraphs = table.getCell(row, column).body.paragraphs;
            paragraphs.load('items');
            cells.push({ row, column, paragraphs });
            remainingCells--;
          }
        }
        return cells;
      });
      await context.sync();
      for (const cells of targets)
        for (const cell of cells)
          for (const paragraph of cell.paragraphs.items) paragraph.load(['uniqueLocalId', 'text']);
      await context.sync();
      records = ts.map((t, index) => ({
        values: t.values,
        rowCount: t.rowCount,
        columnCount: t.columnCount,
        style: t.style,
        headerRowCount: t.headerRowCount,
        cellTargetsTruncated:
          targets[index]!.length < t.values.reduce((total, row) => total + row.length, 0),
        cells: targets[index]!.map(({ row, column, paragraphs }) => ({
          row,
          column,
          paragraphs: paragraphs.items.map((paragraph, paragraphIndex) => {
            const id = rememberParagraph(state, story, paragraph, {
              kind: 'cell',
              table: offset + index,
              row,
              column,
              index: paragraphIndex,
            });
            return { id, text: paragraph.text };
          }),
        })),
      }));
    } else if (area === 'controls') {
      const cs = body.contentControls.items.slice(offset, offset + limit);
      for (const c of cs)
        c.load([
          'tag',
          'title',
          'text',
          'subtype',
          'isBound',
          'cannotEdit',
          'cannotDelete',
          'placeholderShown',
        ]);
      await context.sync();
      records = cs.map((c) => ({
        tag: c.tag,
        title: c.title,
        text: c.text,
        subtype: c.subtype,
        isBound: c.isBound,
        cannotEdit: c.cannotEdit,
        cannotDelete: c.cannotDelete,
        placeholderShown: c.placeholderShown,
      }));
    } else if (area === 'lists') {
      const ls = body.lists.items.slice(offset, offset + limit);
      for (const l of ls) {
        l.load('id');
        l.paragraphs.load('items');
      }
      await context.sync();
      for (const l of ls)
        for (const p of l.paragraphs.items) {
          p.load(['uniqueLocalId', 'text']);
          p.listItem.load('level');
        }
      await context.sync();
      records = ls.map((l, index) => ({
        id: l.id,
        paragraphs: l.paragraphs.items.map((p, paragraphIndex) => {
          const id = rememberParagraph(state, story, p, {
            kind: 'list',
            list: offset + index,
            index: paragraphIndex,
          });
          return { id, text: p.text, level: p.listItem.level };
        }),
      }));
    } else if (area === 'comments') {
      // Reuse the loaded collection: getComments() can return a fresh proxy.
      const cs = collection.items.slice(
        offset,
        offset + limit
      ) as import('@docx-editor.dev/editor-api').Comment[];
      for (const c of cs) {
        c.load(['id', 'text', 'resolved', 'authorName']);
        c.replies.load('items');
      }
      await context.sync();
      for (const c of cs) for (const r of c.replies.items) r.load(['text', 'authorName']);
      await context.sync();
      records = cs.map((c) => ({
        id: c.id,
        text: c.text,
        resolved: c.resolved,
        author: c.authorName,
        replies: c.replies.items.map((r, index) => ({ index, text: r.text, author: r.authorName })),
      }));
    } else if (area === 'revisions') {
      const rs = body.revisions.items.slice(offset, offset + limit);
      for (const r of rs) r.load(['type', 'author']);
      await context.sync();
      const ranges = rs.map((r) => r.range);
      for (const r of ranges) r.load('text');
      await context.sync();
      records = rs.map((r, i) => ({ type: r.type, author: r.author, text: ranges[i]!.text }));
    } else if (area === 'sections') {
      const ss = context.document.sections.items.slice(offset, offset + limit);
      for (const s of ss)
        s.pageSetup.load([
          'orientation',
          'pageWidth',
          'pageHeight',
          'leftMargin',
          'rightMargin',
          'topMargin',
          'bottomMargin',
        ]);
      await context.sync();
      records = ss.map((s) => ({
        orientation: s.pageSetup.orientation,
        pageWidth: s.pageSetup.pageWidth,
        pageHeight: s.pageSetup.pageHeight,
        leftMargin: s.pageSetup.leftMargin,
        rightMargin: s.pageSetup.rightMargin,
        topMargin: s.pageSetup.topMargin,
        bottomMargin: s.pageSetup.bottomMargin,
      }));
    } else if (area === 'pictures') {
      const ps = body.inlinePictures.items.slice(offset, offset + limit);
      for (const p of ps) p.load(['width', 'height', 'lockAspectRatio', 'altTextDescription']);
      await context.sync();
      records = ps.map((p) => ({
        width: p.width,
        height: p.height,
        lockAspectRatio: p.lockAspectRatio,
        altTextDescription: p.altTextDescription,
      }));
    } else {
      const fs = body.fields.items.slice(offset, offset + limit);
      for (const f of fs) f.load('code');
      await context.sync();
      records = fs.map((f) => ({ code: f.code }));
    }
    const key = `${storyKey(story)}:${area}`;
    const seen = state.inspected.get(key) ?? new Set<number>();
    items.forEach((_, i) => seen.add(offset + i));
    state.inspected.set(key, seen);
    return {
      area,
      story,
      tracking: context.document.changeTrackingMode,
      items: records.map((record, i) => ({ index: offset + i, ...(record as object) })),
      nextOffset: offset + limit < collection.items.length ? offset + limit : null,
    };
  });
}
