// Growing and shrinking the font of a selection: `increaseFontSize` and `decreaseFontSize`.
//
// Each run steps from its own size, so a selection with several sizes keeps the differences
// between them. The size box reads blank for such a selection, and the steppers stayed
// disabled because they could only write one size for the whole selection.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { mountPaginatedSurface } from '../paginated-surface.ts';
import { createKeyDownHandler } from '../surface-input.ts';
import { toolbarCommandState } from '../toolbar-commands.ts';
import { wholeTableCellSelection } from '../../layout/semantic-cell-selection.ts';
import { serializeOoxmlPart, type OoxmlNode } from '@docx-editor.dev/core/store';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const STYLE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';
const HEADER_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const HEADER_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';

/** Default text is 11 pt; the `Title` paragraph style is 16 pt; `BigChar` text is 14 pt. */
const STYLES =
  `<w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr>` +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/>' +
  '</w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>' +
  '<w:rPr><w:sz w:val="32"/></w:rPr></w:style>' +
  '<w:style w:type="character" w:styleId="BigChar"><w:name w:val="Big Char"/>' +
  '<w:rPr><w:sz w:val="28"/></w:rPr></w:style>' +
  '</w:styles>';

/** A package with `body`, and with `header` as the default header's content when given. */
function docx(body: string, header?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        (header ? `<Override PartName="/word/header1.xml" ContentType="${HEADER_TYPE}"/>` : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId9" Type="${STYLE_REL}" Target="styles.xml"/>` +
        (header ? `<Relationship Id="rId10" Type="${HEADER_REL}" Target="header1.xml"/>` : '') +
        '</Relationships>'
    ),
    'word/styles.xml': strToU8(STYLES),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}` +
        (header ? '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr>' : '') +
        '</w:body></w:document>'
    ),
    ...(header ? { 'word/header1.xml': strToU8(`<w:hdr xmlns:w="${W}">${header}</w:hdr>`) } : {}),
  });
}

const p = (runs: string, pPr = '') => `<w:p>${pPr}${runs}</w:p>`;
const run = (text: string, rPr = '') => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const sized = (text: string, halfPoints: number) =>
  run(text, `<w:rPr><w:sz w:val="${halfPoints}"/></w:rPr>`);

function withEditor(
  body: string,
  check: (editor: DocxEditorInstance) => void | Promise<void>,
  header?: string
): Promise<void> | void {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: docx(body, header) });
  if (!editor.surface) throw new Error('surface failed to mount');
  const done = () => {
    editor.destroy();
    container.remove();
  };
  try {
    const result = check(editor);
    if (result instanceof Promise) return result.finally(done);
  } catch (error) {
    done();
    throw error;
  }
  done();
}

function select(editor: DocxEditorInstance, from: [number, number], to: [number, number]): void {
  const ids = editor.surface!.session.paragraphIds();
  editor.surface!.setSelection({
    anchor: { paragraphId: ids[from[0]]!, offset: from[1] },
    head: { paragraphId: ids[to[0]]!, offset: to[1] },
  });
}

function paragraphNodes(root: OoxmlNode): OoxmlNode[] {
  const found: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'paragraph') found.push(node);
    if (node.kind === 'textValue') return;
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}

function sizesOf(container: OoxmlNode | undefined): string {
  if (!container || container.kind === 'textValue') return '-';
  const sizes = container.children.flatMap((child) => {
    if (child.kind === 'textValue' || (child.localName !== 'sz' && child.localName !== 'szCs')) {
      return [];
    }
    const val = child.attributes.find((entry) => entry.localName === 'val')?.value;
    return [`${child.localName}=${val}`];
  });
  return sizes.length > 0 ? sizes.join(',') : '-';
}

/** Each paragraph's runs as `text:sizes`, where `-` means the run states no size. */
function runSizes(root: OoxmlNode): string[][] {
  return paragraphNodes(root).map((paragraph) => {
    if (paragraph.kind === 'textValue') return [];
    return paragraph.children
      .filter((child) => child.kind === 'run')
      .map((child) => {
        if (child.kind === 'textValue') return '';
        const text = child.children
          .flatMap((part) =>
            part.kind !== 'textValue' && part.localName === 't'
              ? part.children.map((value) => (value.kind === 'textValue' ? value.value : ''))
              : []
          )
          .join('');
        return `${text}:${sizesOf(child.children.find((part) => part.kind === 'runProperties'))}`;
      });
  });
}

/** Each paragraph mark's sizes (`w:pPr/w:rPr`). */
function markSizes(root: OoxmlNode): string[] {
  return paragraphNodes(root).map((paragraph) => {
    if (paragraph.kind === 'textValue') return '-';
    const pPr = paragraph.children.find((child) => child.kind === 'paragraphProperties');
    if (!pPr || pPr.kind === 'textValue') return '-';
    return sizesOf(
      pPr.children.find((child) => child.kind !== 'textValue' && child.localName === 'rPr')
    );
  });
}

const bodyRoot = (editor: DocxEditorInstance) => editor.surface!.session.part().root;

describe('font size steps over a selection with mixed sizes', () => {
  test('the size steppers are enabled and each run steps from its own size', () => {
    withEditor(p(sized('Big', 52) + run(' small')), (editor) => {
      select(editor, [0, 0], [0, 9]);
      expect(editor.snapshot().formatting?.fontSizePt ?? null).toBeNull();
      expect(toolbarCommandState(editor, 'font.size').enabled).toBe(true);
      expect(editor.can({ type: 'increaseFontSize' })).toEqual({ ok: true });

      expect(editor.exec({ type: 'increaseFontSize' })).toEqual({ ok: true, changed: true });
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=56', ' small:sz=24']]);

      expect(editor.exec({ type: 'decreaseFontSize' })).toEqual({ ok: true, changed: true });
      expect(editor.exec({ type: 'decreaseFontSize' })).toEqual({ ok: true, changed: true });
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=48', ' small:sz=20']]);
    });
  });

  test('each step is one undo step, and redo repeats it', () => {
    withEditor(p(sized('Big', 52) + run(' small')), (editor) => {
      select(editor, [0, 0], [0, 9]);
      editor.exec({ type: 'increaseFontSize' });
      editor.exec({ type: 'increaseFontSize' });
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=72', ' small:sz=28']]);
      editor.exec({ type: 'undo' });
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=56', ' small:sz=24']]);
      editor.exec({ type: 'undo' });
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=52', ' small:-']]);
      editor.exec({ type: 'redo' });
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=56', ' small:sz=24']]);
    });
  });

  test('a partly selected run steps only its selected text', () => {
    withEditor(p(sized('Big', 52) + run(' small')), (editor) => {
      select(editor, [0, 1], [0, 6]);
      editor.exec({ type: 'increaseFontSize' });
      expect(runSizes(bodyRoot(editor))).toEqual([['B:sz=52', 'ig:sz=56', ' sm:sz=24', 'all:-']]);
    });
  });

  test('a run with no direct size steps from the size its paragraph style gives it', () => {
    withEditor(
      p(sized('Tiny ', 16) + run('Heading'), '<w:pPr><w:pStyle w:val="Title"/></w:pPr>'),
      (editor) => {
        select(editor, [0, 0], [0, 12]);
        editor.exec({ type: 'increaseFontSize' });
        expect(runSizes(bodyRoot(editor))).toEqual([['Tiny :sz=18', 'Heading:sz=36']]);
      }
    );
  });

  test('a run with a character style steps from the size that style gives it', () => {
    withEditor(
      p(run('styled', '<w:rPr><w:rStyle w:val="BigChar"/></w:rPr>') + run(' plain')),
      (editor) => {
        select(editor, [0, 0], [0, 12]);
        editor.exec({ type: 'increaseFontSize' });
        // 14 pt grows to 16 pt. Reading the run's own properties alone would shrink it to 12 pt.
        expect(runSizes(bodyRoot(editor))).toEqual([['styled:sz=32', ' plain:sz=24']]);
      }
    );
  });

  test('a complex-script run steps from its complex-script size and writes both sizes', () => {
    withEditor(
      p(
        run('שלום', '<w:rPr><w:rtl/><w:sz w:val="20"/><w:szCs w:val="28"/></w:rPr>') + run(' latin')
      ),
      (editor) => {
        select(editor, [0, 0], [0, 10]);
        editor.exec({ type: 'increaseFontSize' });
        // The Hebrew run paints at its 14 pt `w:szCs`, so it grows to 16 pt, not from 10 pt.
        expect(runSizes(bodyRoot(editor))).toEqual([['שלום:sz=32,szCs=32', ' latin:sz=24']]);
      }
    );
  });

  test('a complex-script run with no complex-script size steps from 10 pt, not its w:sz', () => {
    // Layout paints a right-to-left run from `w:szCs` only. This styles part states only
    // `w:sz`, so the Hebrew run paints at the 10 pt default whatever its own `w:sz` says.
    withEditor(
      p(run('שלום', '<w:rPr><w:rtl/><w:sz w:val="40"/></w:rPr>') + run(' latin')),
      (editor) => {
        select(editor, [0, 0], [0, 10]);
        editor.exec({ type: 'increaseFontSize' });
        expect(runSizes(bodyRoot(editor))).toEqual([['שלום:sz=22,szCs=22', ' latin:sz=24']]);
      }
    );
  });

  test('a selection across paragraphs steps every run and every mark it contains', () => {
    withEditor(
      p(sized('Big', 52)) + p(run('middle')) + p(sized('end', 18) + run(' tail')),
      (editor) => {
        select(editor, [0, 0], [2, 8]);
        editor.exec({ type: 'increaseFontSize' });
        expect(runSizes(bodyRoot(editor))).toEqual([
          ['Big:sz=56'],
          ['middle:sz=24'],
          ['end:sz=20', ' tail:sz=24'],
        ]);
        // Each mark steps from its own inherited 11 pt, not from the text beside it.
        expect(markSizes(bodyRoot(editor))).toEqual(['sz=24', 'sz=24', 'sz=24']);
      }
    );
  });

  test('a header paragraph steps from the size its own paragraph style gives it', () => {
    withEditor(
      p(run('body')),
      (editor) => {
        const surface = editor.surface!;
        expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
        const scope = { kind: 'headerFooter', rId: 'rId10' } as const;
        const id = surface.session.paragraphIdsIn(scope)[0]!;
        // "Head" alone reads the 16 pt of the header paragraph's Title style.
        surface.setSelection({
          anchor: { paragraphId: id, offset: 5 },
          head: { paragraphId: id, offset: 9 },
        });
        expect(editor.snapshot().formatting?.fontSizePt).toBe(16);
        surface.setSelection({
          anchor: { paragraphId: id, offset: 0 },
          head: { paragraphId: id, offset: 9 },
        });
        editor.exec({ type: 'increaseFontSize' });
        const header = surface.session.partFor(scope)!.root;
        expect(runSizes(header)).toEqual([['Tiny :sz=18', 'Head:sz=36']]);
      },
      p(sized('Tiny ', 16) + run('Head'), '<w:pPr><w:pStyle w:val="Title"/></w:pPr>')
    );
  });

  test('a run already at the largest size stays, and the other runs still grow', () => {
    withEditor(p(sized('Max', 3276) + run(' small')), (editor) => {
      select(editor, [0, 0], [0, 9]);
      expect(editor.exec({ type: 'increaseFontSize' })).toEqual({ ok: true, changed: true });
      expect(runSizes(bodyRoot(editor))).toEqual([['Max:sz=3276', ' small:sz=24']]);
    });
  });

  test('a rectangular cell selection steps each cell from its own sizes', () => {
    const table =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>' +
      `<w:tr><w:tc>${p(sized('A', 40))}</w:tc><w:tc>${p(run('B'))}</w:tc></w:tr></w:tbl>`;
    withEditor(p(run('Lead')) + table + p(run('After')), (editor) => {
      const surface = editor.surface!;
      const fragment = surface.layout().pages[0]!.fragments.find((entry) => entry.kind === 'table');
      surface.setCellSelection(
        wholeTableCellSelection(surface.layout(), (fragment as { tableId: string }).tableId)
      );
      expect(surface.state().cellSelection).not.toBeNull();
      editor.exec({ type: 'increaseFontSize' });
      expect(runSizes(bodyRoot(editor))).toEqual([
        ['Lead:-'],
        ['A:sz=44'],
        ['B:sz=24'],
        ['After:-'],
      ]);
      expect(surface.state().cellSelection).not.toBeNull();
    });
  });

  test('the sizes survive save and reopen', async () => {
    await withEditor(p(sized('Big', 52) + run(' small')), async (editor) => {
      select(editor, [0, 0], [0, 9]);
      editor.exec({ type: 'increaseFontSize' });
      const bytes = new Uint8Array(await editor.save());
      const container = document.createElement('div');
      document.body.append(container);
      const reopened = createDocxEditor({ container, document: bytes });
      try {
        expect(runSizes(reopened.surface!.session.part().root)).toEqual([
          ['Big:sz=56', ' small:sz=24'],
        ]);
      } finally {
        reopened.destroy();
        container.remove();
      }
    });
  });

  test('a document open for viewing refuses the step', () => {
    withEditor(p(sized('Big', 52) + run(' small')), (editor) => {
      select(editor, [0, 0], [0, 9]);
      editor.exec({ type: 'setEditingMode', mode: 'viewing' });
      expect(editor.can({ type: 'increaseFontSize' }).ok).toBe(false);
      expect(editor.exec({ type: 'increaseFontSize' }).ok).toBe(false);
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=52', ' small:-']]);
    });
  });
});

describe('font size steps over one size', () => {
  test('a selection with one size steps along the ladder', () => {
    withEditor(p(run('Plain text')), (editor) => {
      select(editor, [0, 0], [0, 10]);
      const seen: (number | null | undefined)[] = [];
      for (let index = 0; index < 4; index += 1) {
        editor.exec({ type: 'increaseFontSize' });
        seen.push(editor.snapshot().formatting?.fontSizePt);
      }
      expect(seen).toEqual([12, 14, 16, 18]);
    });
  });

  test('a caret inside a word steps that word', () => {
    withEditor(p(run('alpha beta')), (editor) => {
      select(editor, [0, 2], [0, 2]);
      editor.exec({ type: 'increaseFontSize' });
      expect(runSizes(bodyRoot(editor))).toEqual([['alpha:sz=24', ' beta:-']]);
    });
  });

  test('a caret at the end of a word arms the next size for typed text', () => {
    withEditor(p(run('alpha')), (editor) => {
      select(editor, [0, 5], [0, 5]);
      expect(editor.exec({ type: 'increaseFontSize' })).toMatchObject({ ok: true });
      expect(editor.snapshot().formatting?.fontSizePt).toBe(12);
      editor.exec({ type: 'insertText', text: '!' });
      expect(runSizes(bodyRoot(editor))).toEqual([['alpha:-', '!:sz=24']]);
    });
  });

  test('text already at the smallest size reports no change', () => {
    withEditor(p(sized('tiny', 2)), (editor) => {
      select(editor, [0, 0], [0, 4]);
      expect(editor.exec({ type: 'decreaseFontSize' })).toEqual({ ok: true, changed: false });
      expect(runSizes(bodyRoot(editor))).toEqual([['tiny:sz=2']]);
    });
  });
});

describe('font size step keyboard shortcuts', () => {
  test('Ctrl+Shift+> grows and Ctrl+Shift+< shrinks each run', () => {
    withEditor(p(sized('Big', 52) + run(' small')), (editor) => {
      select(editor, [0, 0], [0, 9]);
      const keyDown = createKeyDownHandler(editor.surface!);
      const press = (key: string, code: string) => {
        const event = new KeyboardEvent('keydown', {
          key,
          code,
          ctrlKey: true,
          shiftKey: true,
          cancelable: true,
        });
        keyDown(event);
        return event.defaultPrevented;
      };
      expect(press('>', 'Period')).toBe(true);
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=56', ' small:sz=24']]);
      expect(press('<', 'Comma')).toBe(true);
      expect(press('<', 'Comma')).toBe(true);
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=48', ' small:sz=20']]);
      // A layout whose shifted period key types `:` still reaches the step by position.
      expect(press(':', 'Period')).toBe(true);
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=52', ' small:sz=22']]);
      // A layout whose comma key types a letter keeps that letter's chord.
      expect(press('W', 'Comma')).toBe(false);
      expect(runSizes(bodyRoot(editor))).toEqual([['Big:sz=52', ' small:sz=22']]);
    });
  });
});

describe('font size steps in suggesting mode', () => {
  test('each run records its own previous size as a tracked formatting change', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const opened = mountPaginatedSurface(container, docx(p(sized('Big', 52) + run(' small'))), {
      editingMode: 'suggest',
      author: 'Bea',
      revisionDisplayMode: 'all-markup',
    });
    if (!opened.ok) throw new Error(opened.reason);
    const surface = opened.surface;
    try {
      const id = surface.session.paragraphIds()[0]!;
      surface.setSelection({
        anchor: { paragraphId: id, offset: 0 },
        head: { paragraphId: id, offset: 9 },
      });
      expect(surface.stepFontSize('increase')).toBeNull();
      const xml = serializeOoxmlPart(surface.session.part());
      const changes = xml.match(/<w:rPrChange[\s\S]*?<\/w:rPrChange>/g) ?? [];
      // The paragraph mark, then each run, with the size each one had before.
      expect(changes).toHaveLength(3);
      for (const change of changes) expect(change).toContain('w:author="Bea"');
      expect(changes[0]).not.toContain('w:sz');
      expect(changes[1]).toContain('<w:sz w:val="52"/>');
      expect(changes[2]).not.toContain('w:sz');
      expect(runSizes(surface.session.part().root)).toEqual([['Big:sz=56', ' small:sz=24']]);
    } finally {
      surface.destroy();
      container.remove();
    }
  });
});
