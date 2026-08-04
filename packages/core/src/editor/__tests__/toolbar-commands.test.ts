// Toolbar can-before-exec wiring (interactive-paginated-editing M4.0), re-keyed on the
// public `ChromeSlotId` vocabulary — one command table (`commandForSlot`) for both
// adapters, replacing the drifted `ToolbarCommandId`/`ChromeCommandId` pair.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test, afterEach } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import type {
  CanResult,
  Editor,
  EditorCommand,
  ExecResult,
} from '@docx-editor.dev/core-contract/contracts/editor';
import {
  chromeProbeForSlot,
  commandForSlot,
  commandForSlotValue,
  commandForTableChromeSlotValue,
  DEFAULT_TABLE_CHROME_DRAFT,
  runSave,
  runTableChromeCommand,
  runTableCommand,
  runToolbarCommand,
  tableChromeToolbarState,
  tableCommandToolbarState,
  toolbarCommandState,
  toolbarCommandStates,
} from '../toolbar-commands.ts';
import {
  applyTableChromePick,
  defaultTableLabel,
  TABLE_BORDER_STYLE_OPTIONS,
  TABLE_BORDER_TARGET_OPTIONS,
  TABLE_BORDER_WIDTH_OPTIONS,
  TABLE_CHROME_SLOT_IDS,
  tableChromeVisible,
} from '../table-chrome.ts';
import { tableCommandState } from '../docx-editor-derive.ts';
import { createDocxEditor, type DocxEditorInstance } from '../docx-editor.ts';
import { paragraphTextOf } from '../../store/store/tree-ops.ts';

const liveToolbarEditors: DocxEditorInstance[] = [];

afterEach(() => {
  while (liveToolbarEditors.length > 0) {
    liveToolbarEditors.pop()?.destroy();
  }
  document.getSelection()?.removeAllRanges();
  for (const node of [...document.body.children]) {
    if (node instanceof HTMLElement && node.querySelector('.docx-pages')) {
      node.remove();
    }
  }
});

interface Calls {
  readonly can: EditorCommand[];
  readonly exec: EditorCommand[];
  saves: number;
}

function fakeEditor(
  canResult: (command: EditorCommand) => CanResult,
  execResult: ExecResult = { ok: true, changed: true }
): { editor: Editor; calls: Calls } {
  const calls: Calls = { can: [], exec: [], saves: 0 };
  const editor = {
    can: (command: EditorCommand) => {
      calls.can.push(command);
      return canResult(command);
    },
    exec: (command: EditorCommand) => {
      calls.exec.push(command);
      return execResult;
    },
    save: async () => {
      calls.saves += 1;
      return new ArrayBuffer(8);
    },
  } as unknown as Editor;
  return { editor, calls };
}

const ALLOW = (): CanResult => ({ ok: true });
const DENY = (reason: string) => (): CanResult => ({ ok: false, code: 'unsupported', reason });

describe('slot → command table (commandForSlot)', () => {
  test('wired slots resolve to their public editor commands', () => {
    expect(commandForSlot('text.bold')).toEqual({ type: 'toggleMark', mark: 'bold' });
    expect(commandForSlot('text.italic')).toEqual({ type: 'toggleMark', mark: 'italic' });
    expect(commandForSlot('text.underline')).toEqual({ type: 'toggleMark', mark: 'underline' });
    expect(commandForSlot('text.strike')).toEqual({ type: 'toggleMark', mark: 'strike' });
    expect(commandForSlot('history.undo')).toEqual({ type: 'undo' });
    expect(commandForSlot('history.redo')).toEqual({ type: 'redo' });
    expect(commandForSlot('alignment.left')).toEqual({ type: 'setAlignment', align: 'left' });
    expect(commandForSlot('alignment.center')).toEqual({ type: 'setAlignment', align: 'center' });
    expect(commandForSlot('alignment.right')).toEqual({ type: 'setAlignment', align: 'right' });
    expect(commandForSlot('alignment.justify')).toEqual({ type: 'setAlignment', align: 'justify' });
    expect(commandForSlot('insert.pageNumber')).toEqual({ type: 'insertPageField', field: 'PAGE' });
    expect(commandForSlot('insert.pageXofY')).toEqual({
      type: 'insertPageField',
      field: 'PAGE_X_OF_Y',
    });
  });

  test('an unwired slot answers null, never an invented command', () => {
    expect(commandForSlot('text.highlight')).toBeNull();
    expect(commandForSlot('font.family')).toBeNull();
    // Save is not a command — it goes through runSave.
    expect(commandForSlot('file.save')).toBeNull();
  });
});

describe('toolbar command wiring (task M4.0)', () => {
  test('a control asks can() and is enabled by its answer', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    // `active` comes from `Editor.isActive`; the fake editor omits the method entirely,
    // which must read as "not active", never crash.
    expect(toolbarCommandState(editor, 'text.bold')).toEqual({
      id: 'text.bold',
      enabled: true,
      disabledReason: null,
      active: false,
    });
    expect(calls.can).toEqual([{ type: 'toggleMark', mark: 'bold' }]);
  });

  test('active reflects Editor.isActive when the editor implements it', () => {
    const { editor } = fakeEditor(ALLOW);
    (editor as { isActive?: (c: EditorCommand) => boolean }).isActive = (c) =>
      c.type === 'toggleMark' && c.mark === 'bold';
    expect(toolbarCommandState(editor, 'text.bold').active).toBe(true);
    expect(toolbarCommandState(editor, 'text.italic').active).toBe(false);
  });

  test('an unwired slot is disabled without ever calling the editor', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    // `insert.toc` has no command and no probe: genuinely unwired, and it says so without
    // troubling the engine. (`text.highlight` graduated to a value-typed slot, `text.link` to
    // a chrome-driven one, `review.comments` now toggles the review pane and
    // `list.lineSpacing` got its own picker; all of them ASK the engine, which is the point.)
    const state = toolbarCommandState(editor, 'insert.toc');
    expect(state.enabled).toBe(false);
    expect(state.disabledReason).toBe('not wired to an editor command');
    expect(calls.can).toEqual([]);
    expect(runToolbarCommand(editor, 'insert.toc')).toEqual({
      ok: false,
      code: 'unsupported',
      reason: 'not wired to an editor command',
    });
    expect(calls.exec).toEqual([]);
  });

  test('a chrome-driven slot stays out of the shared table, and offers a probe instead', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    // `text.link` is NOT in `SLOT_COMMANDS`. Putting it there would enable the control in
    // EVERY adapter — including one with no link UI, where an enabled button can only be
    // refused, which is the worse lie. Chrome that owns a link UI asks with the probe and
    // dispatches through that UI; chrome that does not gets the honest unwired answer.
    expect(commandForSlot('text.link')).toBeNull();
    expect(toolbarCommandState(editor, 'text.link')).toEqual({
      id: 'text.link',
      enabled: false,
      disabledReason: 'not wired to an editor command',
      active: false,
    });
    // The shared table DOES consult the probe — `can` is a pure predicate — but an
    // ALLOWED probe never enables the control: the gap is the adapter's UI, not the
    // engine's capability, so the answer stays the unwired one.
    expect(calls.can).toEqual([{ type: 'insertHyperlink', href: 'https://example.com' }]);

    const probe = chromeProbeForSlot('text.link');
    expect(probe).toEqual({ type: 'insertHyperlink', href: 'https://example.com' });
    // The probe is a real command the engine can answer — that is the whole point of it.
    expect(editor.can(probe!).ok).toBe(true);
  });

  test("a REFUSED probe is quoted verbatim, so the reason is the engine's own words", () => {
    // The reason a menu row for image or table insertion is greyed out should be the
    // engine saying it cannot do it, not chrome guessing. Both have a real command shape
    // (`insertImage`/`insertTable` are in the edit vocabulary) that the engine can judge.
    const { editor } = fakeEditor(
      DENY("command 'insertTable' is not supported by the tree editor")
    );
    expect(commandForSlot('table.insert')).toBeNull();
    expect(toolbarCommandState(editor, 'table.insert')).toEqual({
      id: 'table.insert',
      enabled: false,
      disabledReason: "command 'insertTable' is not supported by the tree editor",
      active: false,
    });
    expect(toolbarCommandState(editor, 'image.insert').disabledReason).toBe(
      "command 'insertTable' is not supported by the tree editor"
    );
  });

  test("a slot with NO command shape still says so in chrome's words, honestly", () => {
    // `insert.toc` has no entry in the edit vocabulary at all, so there is nothing to
    // probe with and no engine opinion to quote. Chrome answers, and says which of the
    // two situations it is.
    const { editor, calls } = fakeEditor(ALLOW);
    expect(chromeProbeForSlot('insert.toc')).toBeNull();
    expect(toolbarCommandState(editor, 'insert.toc').disabledReason).toBe(
      'not wired to an editor command'
    );
    expect(calls.can).toEqual([]);
  });

  test('a slot with no link UI has no probe', () => {
    expect(chromeProbeForSlot('text.bold')).toBeNull();
    expect(chromeProbeForSlot('review.comments')).toBeNull();
  });

  test('a refused control is disabled and carries the engine reason verbatim', () => {
    const { editor } = fakeEditor(DENY('underline is not modeled as a toggle'));
    const state = toolbarCommandState(editor, 'text.underline');
    expect(state.enabled).toBe(false);
    // The reason must be the engine's own words, not an adapter paraphrase.
    expect(state.disabledReason).toBe('underline is not modeled as a toggle');
  });

  test('exec never runs when can() said no', () => {
    const { editor, calls } = fakeEditor(DENY('nope'));
    const result = runToolbarCommand(editor, 'text.bold');
    expect(result).toEqual({ ok: false, code: 'unsupported', reason: 'nope' });
    expect(calls.exec).toEqual([]);
  });

  test('exec runs exactly once after can() said yes', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    expect(runToolbarCommand(editor, 'text.italic')).toEqual({ ok: true, changed: true });
    expect(calls.can).toHaveLength(1);
    expect(calls.exec).toEqual([{ type: 'toggleMark', mark: 'italic' }]);
  });

  test('a refusal is returned as a refusal, never flattened into a no-op', () => {
    const { editor } = fakeEditor(DENY('locked'));
    const result = runToolbarCommand(editor, 'history.undo');
    expect(result.ok).toBe(false);
    // A caller must be able to tell "declined" from "ran and changed nothing".
    expect(result).not.toEqual({ ok: true, changed: false });
  });

  test('a missing editor disables every control instead of throwing', () => {
    const states = toolbarCommandStates(null, [
      'text.bold',
      'text.italic',
      'text.underline',
      'history.undo',
      'history.redo',
    ]);
    expect(states.every((s) => !s.enabled)).toBe(true);
    expect(states.every((s) => s.disabledReason === 'editor is not ready')).toBe(true);
    expect(runToolbarCommand(null, 'text.bold').ok).toBe(false);
  });

  test('save calls Editor.save directly and is not routed through can/exec', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    void runSave(editor);
    expect(calls.saves).toBe(1);
    expect(calls.can).toEqual([]);
    expect(calls.exec).toEqual([]);
  });

  test('states are computed per control, not shared', () => {
    const { editor } = fakeEditor((command) =>
      command.type === 'toggleMark' && command.mark === 'underline'
        ? { ok: false, code: 'unsupported', reason: 'w:u carries a style' }
        : { ok: true }
    );
    const states = toolbarCommandStates(editor, ['text.bold', 'text.underline', 'history.undo']);
    expect(states.map((s) => s.enabled)).toEqual([true, false, true]);
    expect(states[1]!.disabledReason).toBe('w:u carries a style');
  });
});

describe('value-typed slots (commandForSlotValue)', () => {
  test('resolves the four value slots to setMarkAttr commands carrying the value', () => {
    expect(commandForSlotValue('font.family', 'Georgia')).toEqual({
      type: 'setMarkAttr',
      mark: 'fontFamily',
      attr: 'family',
      value: 'Georgia',
    });
    expect(commandForSlotValue('font.size', 28)).toEqual({
      type: 'setMarkAttr',
      mark: 'fontSize',
      attr: 'val',
      value: 28,
    });
    expect(commandForSlotValue('text.color', 'FF0000')).toEqual({
      type: 'setMarkAttr',
      mark: 'color',
      attr: 'val',
      value: 'FF0000',
    });
    expect(commandForSlotValue('text.highlight', 'yellow')).toEqual({
      type: 'setMarkAttr',
      mark: 'highlight',
      attr: 'val',
      value: 'yellow',
    });
    // A slot that does not take a value has no value command.
    expect(commandForSlotValue('text.bold', true)).toBeNull();
    expect(commandForSlotValue('image.insert', 'x')).toBeNull();
  });

  test('toolbarCommandState answers enabled-when-editable and never active for value slots', () => {
    const { editor, calls } = fakeEditor(ALLOW);
    const state = toolbarCommandState(editor, 'font.family');
    expect(state).toEqual({
      id: 'font.family',
      enabled: true,
      disabledReason: null,
      active: false,
    });
    // The probe asked `can` with a well-formed setMarkAttr, not a bare slot command.
    expect(calls.can[0]).toMatchObject({ type: 'setMarkAttr', mark: 'fontFamily' });

    const denied = fakeEditor(DENY('the document is read-only'));
    expect(toolbarCommandState(denied.editor, 'font.size')).toEqual({
      id: 'font.size',
      enabled: false,
      disabledReason: 'the document is read-only',
      active: false,
    });
  });
});

// Task 7: table command can-before-exec parity. Chrome slot mapping remains Task 9.
describe('table command toolbar state (Task 7)', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const TABLE_2X2 =
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

  function mountTable(body: string): DocxEditorInstance {
    const doc = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: doc });
    if (!editor.surface) throw new Error('surface failed to mount');
    liveToolbarEditors.push(editor);
    return editor;
  }

  function paragraphByText(editor: DocxEditorInstance, text: string): string {
    for (const id of editor.surface!.session.paragraphIds()) {
      if (paragraphTextOf(editor.surface!.session.part(), id) === text) return id;
    }
    throw new Error(`paragraph ${text} not found`);
  }

  function caret(editor: DocxEditorInstance, paragraphId: string): void {
    editor.surface!.setSelection({
      head: { paragraphId, offset: 1 },
      anchor: { paragraphId, offset: 1 },
    });
  }

  test('tableCommandToolbarState matches Editor.can via tableCommandState', () => {
    const editor = mountTable(TABLE_2X2);
    const surface = editor.surface!;
    caret(editor, paragraphByText(editor, 'A1'));
    const cmd = { type: 'insertRow' as const, where: 'below' as const };
    const can = editor.can(cmd);
    expect(tableCommandToolbarState(surface, cmd)).toEqual({
      enabled: can.ok,
      disabledReason: can.ok ? null : can.reason,
    });
    expect(tableCommandState(cmd, surface).can).toEqual(can);
  });

  test('runTableCommand execs when enabled', () => {
    const editor = mountTable(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const cmd = { type: 'insertRow' as const, where: 'below' as const };
    expect(tableCommandToolbarState(editor.surface, cmd).enabled).toBe(true);
    expect(runTableCommand(editor, cmd).ok).toBe(true);
  });

  test('final column refusal matches can and exec verbatim', () => {
    const oneCol =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>only</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const editor = mountTable(oneCol);
    caret(editor, paragraphByText(editor, 'only'));
    const cmd = { type: 'deleteColumn' as const };
    const can = editor.can(cmd);
    expect(tableCommandToolbarState(editor.surface, cmd)).toEqual({
      enabled: false,
      disabledReason: 'the table must keep at least one row or column',
    });
    expect(can.reason).toBe('the table must keep at least one row or column');
    expect(runTableCommand(editor, cmd)).toEqual(can);
  });

  test('merged-cell refusal matches can and exec verbatim', () => {
    const merged =
      '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
      '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>span</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const editor = mountTable(merged);
    caret(editor, paragraphByText(editor, 'A1'));
    const cmd = { type: 'insertColumn' as const, where: 'right' as const };
    const can = editor.can(cmd);
    expect(tableCommandToolbarState(editor.surface, cmd).disabledReason).toBe(
      'this table has merged cells'
    );
    expect(runTableCommand(editor, cmd)).toEqual(can);
  });
});

describe('table chrome slots (Task 9)', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const TABLE_2X2 =
    '<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="3600"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

  function mountTable(body: string): DocxEditorInstance {
    const doc = zipSync({
      '[Content_Types].xml': strToU8(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
      ),
      '_rels/.rels': strToU8(
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
      ),
      'word/document.xml': strToU8(
        `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
      ),
    });
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({ container, document: doc });
    if (!editor.surface) throw new Error('surface failed to mount');
    liveToolbarEditors.push(editor);
    return editor;
  }

  function paragraphByText(editor: DocxEditorInstance, text: string): string {
    for (const id of editor.surface!.session.paragraphIds()) {
      if (paragraphTextOf(editor.surface!.session.part(), id) === text) return id;
    }
    throw new Error(`paragraph ${text} not found`);
  }

  function caret(editor: DocxEditorInstance, paragraphId: string): void {
    editor.surface!.setSelection({
      head: { paragraphId, offset: 1 },
      anchor: { paragraphId, offset: 1 },
    });
  }

  test('registry exposes five contextual table chrome slots with preview vocabulary', () => {
    expect(TABLE_CHROME_SLOT_IDS).toEqual([
      'table.borderTarget',
      'table.borderColor',
      'table.borderStyle',
      'table.borderWidth',
      'table.cellFill',
    ]);
    expect(TABLE_BORDER_TARGET_OPTIONS).toHaveLength(8);
    expect(TABLE_BORDER_STYLE_OPTIONS).toHaveLength(6);
    expect(TABLE_BORDER_WIDTH_OPTIONS).toHaveLength(5);
    for (const slot of TABLE_CHROME_SLOT_IDS) {
      expect(commandForSlot(slot)).toBeNull();
    }
  });

  test('table chrome is visible only under table context', () => {
    const editor = mountTable(`<w:p><w:r><w:t>before</w:t></w:r></w:p>${TABLE_2X2}`);
    expect(tableChromeVisible(editor.snapshot().table)).toBe(false);
    caret(editor, paragraphByText(editor, 'A1'));
    expect(tableChromeVisible(editor.snapshot().table)).toBe(true);
  });

  test('choosing a border target applies the current complete spec and updates active target', () => {
    const draft = DEFAULT_TABLE_CHROME_DRAFT;
    const pick = applyTableChromePick(draft, 'table.borderTarget', 'inside');
    expect(pick?.command).toEqual({
      type: 'setTableBorders',
      scope: 'inside',
      spec: draft.spec,
    });
    expect(pick?.nextDraft.activeTarget).toBe('inside');
  });

  test('choosing none clears the active target without changing it', () => {
    const draft = { ...DEFAULT_TABLE_CHROME_DRAFT, activeTarget: 'top' as const };
    const pick = applyTableChromePick(draft, 'table.borderTarget', 'none');
    expect(pick?.command).toEqual({ type: 'setTableBorders', scope: 'none', target: 'top' });
    expect(pick?.nextDraft.activeTarget).toBe('top');
  });

  test('color style and width picks dispatch complete specs against the active target', () => {
    const draft = { ...DEFAULT_TABLE_CHROME_DRAFT, activeTarget: 'outside' as const };
    expect(
      applyTableChromePick(draft, 'table.borderColor', { kind: 'hex', value: '336699' })?.command
    ).toEqual({
      type: 'setTableBorders',
      scope: 'outside',
      spec: { ...draft.spec, color: { kind: 'hex', value: '336699' } },
    });
    expect(applyTableChromePick(draft, 'table.borderStyle', 'dotted')?.command).toEqual({
      type: 'setTableBorders',
      scope: 'outside',
      spec: { ...draft.spec, style: 'dotted' },
    });
    expect(applyTableChromePick(draft, 'table.borderWidth', 12)?.command).toEqual({
      type: 'setTableBorders',
      scope: 'outside',
      spec: { ...draft.spec, size: 12 },
    });
  });

  test('clear fill dispatches setCellFill null', () => {
    expect(
      applyTableChromePick(DEFAULT_TABLE_CHROME_DRAFT, 'table.cellFill', null)?.command
    ).toEqual({
      type: 'setCellFill',
      color: null,
    });
  });

  test('tableChromeToolbarState matches Editor.can via the planner seam', () => {
    const editor = mountTable(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    for (const slot of TABLE_CHROME_SLOT_IDS) {
      const state = tableChromeToolbarState(editor, slot);
      const probe = commandForTableChromeSlotValue(
        slot,
        slot === 'table.cellFill'
          ? { kind: 'hex', value: 'FF0000' }
          : slot === 'table.borderTarget'
            ? 'all'
            : slot === 'table.borderStyle'
              ? 'single'
              : slot === 'table.borderWidth'
                ? 8
                : { kind: 'hex', value: '000000' },
        DEFAULT_TABLE_CHROME_DRAFT
      )!;
      const can = editor.can(probe);
      expect(state.enabled).toBe(can.ok);
      expect(state.disabledReason).toBe(can.ok ? null : can.reason);
    }
  });

  test('viewing mode refusal matches can and exec verbatim for table chrome', () => {
    const editor = mountTable(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    editor.exec({ type: 'setEditingMode', mode: 'viewing' });
    const cmd = commandForTableChromeSlotValue(
      'table.borderTarget',
      'all',
      DEFAULT_TABLE_CHROME_DRAFT
    )!;
    const can = editor.can(cmd);
    expect(tableChromeToolbarState(editor, 'table.borderTarget').disabledReason).toBe(can.reason);
    expect(
      runTableChromeCommand(editor, 'table.borderTarget', 'all', DEFAULT_TABLE_CHROME_DRAFT).result
    ).toEqual(can);
  });

  test('runTableChromeCommand execs when enabled and returns next draft', () => {
    const editor = mountTable(TABLE_2X2);
    caret(editor, paragraphByText(editor, 'A1'));
    const { result, nextDraft } = runTableChromeCommand(
      editor,
      'table.borderTarget',
      'inside',
      DEFAULT_TABLE_CHROME_DRAFT
    );
    expect(result.ok).toBe(true);
    expect(nextDraft?.activeTarget).toBe('inside');
  });

  test('defaultTableLabel resolves insertion labels from en.json', () => {
    expect(defaultTableLabel('table.insertRowBelow')).toBe('Insert row below');
    expect(defaultTableLabel('table.insertColumnRight')).toBe('Insert column right');
  });
});
