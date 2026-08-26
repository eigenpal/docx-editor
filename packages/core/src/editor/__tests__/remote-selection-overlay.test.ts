// Remote presence overlay paints every line of a multi-paragraph selection.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { afterEach, describe, expect, test } from 'bun:test';
import type {
  CollaborationLocalSelection,
  CollaborationRemoteSelection,
  EditorCollaborationSession,
} from '@docx-editor.dev/core/collaboration';
import { zipSync, strToU8 } from 'fflate';
import {
  collaborationParagraphScanRecorder,
  paragraphSnapshot,
} from '../../collaboration/paragraph-addresses.ts';
import { readOoxmlPackage } from '../../store/package/ooxml-package.ts';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { docx, paragraph, putCaret, selectCellRectangle } from './paginated-surface-fixtures.ts';

const opened: { surface: PaginatedSurface; container: HTMLElement }[] = [];

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  for (const item of opened.splice(0)) {
    item.surface.destroy();
    item.container.remove();
  }
});

function stubSession(
  remotes: () => readonly CollaborationRemoteSelection[],
  onLocal?: (selection: CollaborationLocalSelection | null) => void
): {
  readonly session: EditorCollaborationSession;
  readonly notify: () => void;
} {
  const listeners = new Set<(selections: readonly CollaborationRemoteSelection[]) => void>();
  const notify = (): void => {
    const next = remotes();
    for (const listener of listeners) listener(next);
  };
  return {
    notify,
    session: {
      documentId: 'overlay-test',
      sessionId: 'overlay-session',
      identity: { actorId: 'local', name: 'Local' },
      status: () => 'ready',
      subscribeStatus: () => () => {},
      attach: () => () => {},
      gateOperations: () => null,
      canUndo: () => false,
      canRedo: () => false,
      undo: () => false,
      redo: () => false,
      setLocalSelection: (selection) => onLocal?.(selection),
      participants: () => [],
      subscribeParticipants: () => () => {},
      remoteSelections: remotes,
      subscribeRemoteSelections: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      flushPendingJournals: () => {},
      destroy: () => {},
    },
  };
}

function mountBytes(
  bytes: Uint8Array,
  remotes: () => readonly CollaborationRemoteSelection[],
  onLocal?: (selection: CollaborationLocalSelection | null) => void
) {
  const container = document.createElement('div');
  const { session, notify } = stubSession(remotes, onLocal);
  const result = mountPaginatedSurface(container, bytes, {
    scale: 1,
    collaborationModel: { session },
  });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  opened.push({ surface: result.surface, container });
  return { surface: result.surface, container, notify };
}

function mountBody(
  body: string,
  remotes: () => readonly CollaborationRemoteSelection[],
  onLocal?: (selection: CollaborationLocalSelection | null) => void
) {
  return mountBytes(docx(body), remotes, onLocal);
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function headerDocx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId10" Type="${R}/header" Target="header1.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${paragraph('Body')}` +
        '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/></w:sectPr></w:body></w:document>'
    ),
    'word/header1.xml': strToU8(
      `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Letterhead</w:t></w:r></w:p></w:hdr>`
    ),
  });
}

const TABLE =
  '<w:tbl><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>' +
  '<w:tr><w:tc><w:p><w:r><w:t>A1</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc></w:tr>' +
  '<w:tr><w:tc><w:p><w:r><w:t>A2</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B2</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';

const THREE = paragraph('aaaa') + paragraph('bbbb') + paragraph('cccc');

describe('remote selection overlay', () => {
  test('a multi-paragraph remote selection paints one span per covered line', () => {
    let remotes: CollaborationRemoteSelection[] = [];
    const { surface, container, notify } = mountBody(THREE, () => remotes);
    const ids = surface.session.paragraphIds();
    expect(ids).toHaveLength(3);
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        color: 'var(--doc-accent)',
        anchor: { paragraphId: 'AAAAAAAA', nodeId: ids[0]!, offset: 1 },
        head: { paragraphId: 'CCCCCCCC', nodeId: ids[2]!, offset: 2 },
      },
    ];
    notify();
    const overlay = container.querySelector('.docx-remote-selection-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute('contenteditable')).toBe('false');
    expect(container.querySelector('.docx-pages')?.contains(overlay)).toBe(false);
    expect(container.querySelectorAll('.docx-remote-selection-rect')).toHaveLength(3);
    expect(container.querySelector('.docx-remote-caret-label')?.textContent).toBe('Bob');
  });

  test('a backwards multi-paragraph selection paints the same span count', () => {
    let remotes: CollaborationRemoteSelection[] = [];
    const { surface, container, notify } = mountBody(THREE, () => remotes);
    const ids = surface.session.paragraphIds();
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        anchor: { paragraphId: 'AAAAAAAA', nodeId: ids[0]!, offset: 1 },
        head: { paragraphId: 'CCCCCCCC', nodeId: ids[2]!, offset: 2 },
      },
    ];
    notify();
    const forward = container.querySelectorAll('.docx-remote-selection-rect').length;
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        anchor: { paragraphId: 'CCCCCCCC', nodeId: ids[2]!, offset: 2 },
        head: { paragraphId: 'AAAAAAAA', nodeId: ids[0]!, offset: 1 },
      },
    ];
    notify();
    expect(container.querySelectorAll('.docx-remote-selection-rect').length).toBe(forward);
    expect(forward).toBe(3);
  });

  test('a remote cell rectangle paints one span per selected cell', () => {
    let remotes: CollaborationRemoteSelection[] = [];
    const { surface, container, notify } = mountBody(TABLE, () => remotes);
    const table = surface.layout().pages[0]!.fragments.find((block) => block.kind === 'table');
    if (!table || table.kind !== 'table') throw new Error('no table');
    const paragraphId = (row: number, column: number): string => {
      const block = table.rows[row]!.cells[column]!.blocks[0]!;
      if (block.kind !== 'paragraph') throw new Error('cell is not a paragraph');
      return block.paragraphId;
    };
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        kind: 'cells',
        anchor: { paragraphId: 'A1A1A1A1', nodeId: paragraphId(0, 0), offset: 0 },
        head: { paragraphId: 'B2B2B2B2', nodeId: paragraphId(1, 1), offset: 2 },
      },
    ];
    notify();
    expect(container.querySelectorAll('.docx-remote-selection-rect')).toHaveLength(4);
  });

  test('selecting cells publishes a cell kind, not a text range only', () => {
    let published: CollaborationLocalSelection | null | undefined;
    const { surface } = mountBody(
      TABLE,
      () => [],
      (selection) => {
        published = selection;
      }
    );
    selectCellRectangle(surface, { row: 0, column: 0 }, { row: 1, column: 1 });
    expect(published?.kind).toBe('cells');
    expect(published?.anchor.paragraphId).toMatch(/^[0-9A-F]{8}$/);
    expect(published?.head.paragraphId).toMatch(/^[0-9A-F]{8}$/);
  });

  test('entering a header publishes that paragraph', () => {
    let published: CollaborationLocalSelection | null | undefined;
    const { surface } = mountBytes(
      headerDocx(),
      () => [],
      (selection) => {
        published = selection;
      }
    );
    expect(surface.enterHeaderFooter({ rId: 'rId10' })).toBe(true);
    expect(published?.anchor.paragraphId).toMatch(/^[0-9A-F]{8}$/);
    expect(published?.head.paragraphId).toBe(published?.anchor.paragraphId);
    expect(published?.kind).toBeUndefined();
  });

  // A remote caret that STOPS is not a slow one. Presence was published only by the paths
  // that move the caret deliberately — a click, an arrow key, entering a header — and never
  // by a commit, which is how typing moves it. A burst therefore published nothing at all
  // after the click that started it, and every peer painted that one stale position for as
  // long as the author kept typing. Typing one character with a settle between hides this:
  // the settle is what used to produce the only publish.
  test('a burst of keystrokes publishes the caret each edit left', () => {
    const published: (CollaborationLocalSelection | null)[] = [];
    const { surface } = mountBody(
      paragraph('Font Variations'),
      () => [],
      (selection) => {
        published.push(selection);
      }
    );
    const start = 'Font Variations'.length;
    putCaret(surface, start);
    published.length = 0;
    const digits = '12345678123456765432';
    for (const digit of digits) surface.type(digit);
    const caret = surface.state().selection.head.offset;
    expect(caret).toBe(start + digits.length);
    expect(published.at(-1)?.head.offset).toBe(caret);
    // Never behind, never ahead: each publish names a position the author was actually at.
    expect(published.map((selection) => selection?.head.offset)).toEqual(
      digits.split('').map((_unused, index) => start + index + 1)
    );
  });

  // Presence now leaves on every commit, so its addressing runs at typing rate. It resolves
  // through the store's node index; a document walk there would put the whole document back
  // on the keystroke path (see `collaboration/paragraph-addresses.ts`).
  test('a burst publishes without enumerating paragraphs', () => {
    const { surface } = mountBody(paragraph('Font Variations'), () => []);
    const recorder = collaborationParagraphScanRecorder();
    // The recorder is live: the enumerating read reports into it. Without this the zero
    // below would pass on a counter nothing ever increments.
    const loaded = readOoxmlPackage(docx(paragraph('Font Variations')));
    if (!loaded.ok) throw new Error(loaded.reason);
    recorder.reset();
    paragraphSnapshot(loaded.package.parts.get(loaded.package.mainDocumentPart)!);
    expect(recorder.visits).toBeGreaterThan(0);

    putCaret(surface, 'Font Variations'.length);
    recorder.reset();
    for (const digit of '12345678123456765432') surface.type(digit);
    expect(`${recorder.enumerations} enumerations / ${recorder.visits} visits`).toBe(
      '0 enumerations / 0 visits'
    );
  });

  test('a caret this surface cannot address withdraws presence instead of leaving it', () => {
    const published: (CollaborationLocalSelection | null)[] = [];
    const { surface } = mountBody(
      paragraph('Alpha') + paragraph('Bravo'),
      () => [],
      (selection) => {
        published.push(selection);
      }
    );
    putCaret(surface, 2, 1);
    expect(published.at(-1)).not.toBeNull();
    surface.setSelection({
      anchor: { paragraphId: 'no-such-node', offset: 0 },
      head: { paragraphId: 'no-such-node', offset: 0 },
    });
    expect(published.at(-1)).toBeNull();
  });

  // A withdrawn caret must LEAVE the screen. Keeping the last paint is the failure the
  // report described from the other side: a name pinned to a position nobody is at.
  test('a withdrawn remote selection clears what it painted', () => {
    let remotes: CollaborationRemoteSelection[] = [];
    const { surface, container, notify } = mountBody(THREE, () => remotes);
    const ids = surface.session.paragraphIds();
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        anchor: { paragraphId: 'AAAAAAAA', nodeId: ids[0]!, offset: 1 },
        head: { paragraphId: 'AAAAAAAA', nodeId: ids[0]!, offset: 1 },
      },
    ];
    notify();
    expect(container.querySelectorAll('.docx-remote-caret')).toHaveLength(1);
    expect(container.querySelectorAll('.docx-remote-caret-label')).toHaveLength(1);
    remotes = [];
    notify();
    expect(container.querySelectorAll('.docx-remote-caret')).toHaveLength(0);
    expect(container.querySelectorAll('.docx-remote-caret-label')).toHaveLength(0);
  });

  test('a remote caret in a header paints in the header band', () => {
    let remotes: CollaborationRemoteSelection[] = [];
    const { surface, container, notify } = mountBytes(headerDocx(), () => remotes);
    const header = surface.layout().pages[0]!.header;
    const fragment = header?.fragments.find((block) => block.kind === 'paragraph');
    if (!fragment || fragment.kind !== 'paragraph') throw new Error('no header paragraph');
    remotes = [
      {
        actorId: 'bob',
        name: 'Bob',
        anchor: { paragraphId: 'HHHHHHHH', nodeId: fragment.paragraphId, offset: 0 },
        head: { paragraphId: 'HHHHHHHH', nodeId: fragment.paragraphId, offset: 0 },
      },
    ];
    notify();
    const caret = container.querySelector<HTMLElement>('.docx-remote-caret');
    expect(caret).toBeTruthy();
    const page = surface.layout().pages[0]!;
    expect(header).toBeTruthy();
    const caretTop = Number.parseFloat(caret!.style.top);
    expect(caretTop).toBeLessThan(page.contentBox.y);
    expect(caretTop).toBeGreaterThanOrEqual(header!.box.y);
  });
});
