import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { createEditor } from '../src/create-editor.ts';
import type { EditorHost } from '@docx-editor.dev/core-contract/editor';
import { createEditableParagraphFixture } from '../browser/fixtures.ts';
import type { SemanticSelection } from '@docx-editor.dev/core-contract/interaction';

function hostWith(body: HTMLElement): EditorHost {
  return {
    getBodyHostEl: () => body,
    getHfHostEl: () => null,
    getPagesContainer: () => null,
    getScrollContainer: () => null,
    scheduleFrame: (cb) => {
      cb();
      return () => {};
    },
  };
}

describe('createEditor setSelection command', () => {
  test('syncs frame-bound semantic selection through the public exec surface', () => {
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({
      host: hostWith(body),
      document: createEditableParagraphFixture(),
      accessibleName: 'Etiqueta',
    });

    const entries = editor.getAccessibilityObservation().entries.filter((entry) => entry.role === 'editableParagraph');
    const blockId = entries[0]!.identity.blockId;
    const storyId = entries[0]!.identity.storyId;
    const frameId = editor.getInteractionFrame().id;
    const selection: SemanticSelection = {
      frameId,
      scope: { kind: 'body' },
      anchor: {
        kind: 'text',
        scope: { kind: 'body' },
        identity: { storyId, blockId },
        graphemeOffset: 0,
        affinity: 'upstream',
      },
      head: {
        kind: 'text',
        scope: { kind: 'body' },
        identity: { storyId, blockId },
        graphemeOffset: 3,
        affinity: 'downstream',
      },
    };

    const set = editor.exec({ type: 'setSelection', range: selection });
    expect(set.ok).toBe(true);
    const focus = editor.focus();
    expect(focus.ok).toBe(true);

    const obs = editor.getAccessibilityObservation();
    expect(obs.focus.focused).toBe(true);
    expect(obs.selection?.collapsed).toBe(false);
    if (obs.selection?.anchor.kind === 'text' && obs.selection.head.kind === 'text') {
      expect(obs.selection.anchor.identity.blockId).toBe(blockId);
      expect(obs.selection.head.identity.blockId).toBe(blockId);
      expect(obs.selection.anchor.graphemeOffset).toBe(0);
      expect(obs.selection.head.graphemeOffset).toBe(3);
    }

    editor.destroy();
    body.remove();
  });
});

// The locked-block refusal, which shipped with no coverage (correctness re-review,
// High 2): deleting the check left the whole suite green.
//
// A partially editable document locks INDIVIDUAL blocks. `session.editable` is
// document-wide and stays true, and a locked paragraph is a real model block, so it
// resolves cleanly against canonical state — nothing else in the path stops the caret
// from moving into it. When it did, the frame reported a selection inside the block
// while the accessibility observation reported none, and every keystroke that followed
// was refused by the reverse mapper.
describe('createEditor setSelection refuses read-only blocks', () => {
  test('a caret cannot be placed in a locked paragraph', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const fixture = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({ host: hostWith(body), document: new Uint8Array(readFileSync(fixture)) });

    const entries = editor.getAccessibilityObservation().entries;
    const locked = entries.find((e) => e.role === 'unsupportedStructure');
    const editable = entries.find((e) => e.role === 'editableParagraph' && e.text.length > 3);
    // The fixture must exercise BOTH, or this proves nothing about partial mode.
    expect(locked, 'fixture locks no paragraph').toBeDefined();
    expect(editable, 'fixture has no editable paragraph').toBeDefined();

    const at = (identity: { storyId: string; blockId: string }): SemanticSelection => ({
      frameId: editor.getInteractionFrame().id,
      scope: { kind: 'body' },
      anchor: { kind: 'text', scope: { kind: 'body' }, identity, graphemeOffset: 0, affinity: 'downstream' },
      head: { kind: 'text', scope: { kind: 'body' }, identity, graphemeOffset: 0, affinity: 'downstream' },
    });

    const refused = editor.exec({ type: 'setSelection', range: at(locked!.identity) });
    expect(refused.ok, 'a locked paragraph accepted a caret').toBe(false);
    expect(refused.ok === false && refused.code).toBe('locked');
    // The canonical selection did not move into it.
    const head = editor.getInteractionFrame().selection?.head;
    if (head && head.kind === 'text') expect(head.identity.blockId).not.toBe(locked!.identity.blockId);

    // The control: the same call on an editable paragraph succeeds, so the refusal above
    // is about the POLICY and not about this document refusing every selection.
    expect(editor.exec({ type: 'setSelection', range: at(editable!.identity) }).ok).toBe(true);

    editor.destroy();
    body.remove();
  });
});

// `getSelectionFormatting` is no longer a stub — it derives run properties from canonical
// state. The value of the test is that it fails if the derivation regresses to `null`,
// which is exactly what a stub returns and what typecheck cannot distinguish.
describe('getSelectionFormatting derives from canonical state', () => {
  test('reports the font and size the document actually carries', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const fixture = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({ host: hostWith(body), document: new Uint8Array(readFileSync(fixture)) });

    // A freshly opened document already carries a caret, so the derivation has something
    // to read immediately — my assumption that it would be null was wrong.

    const entry = editor
      .getAccessibilityObservation()
      .entries.find((e) => e.role === 'editableParagraph' && e.text.length > 3);
    expect(entry, 'fixture has no editable paragraph').toBeDefined();
    editor.exec({
      type: 'setSelection',
      range: {
        frameId: editor.getInteractionFrame().id,
        scope: { kind: 'body' },
        anchor: { kind: 'text', scope: { kind: 'body' }, identity: entry!.identity, graphemeOffset: 1, affinity: 'downstream' },
        head: { kind: 'text', scope: { kind: 'body' }, identity: entry!.identity, graphemeOffset: 1, affinity: 'downstream' },
      } as never,
    });

    const fmt = editor.getSelectionFormatting();
    expect(fmt, 'derivation returned null with a live selection').not.toBeNull();
    // The comprehensive fixture bakes rFonts/sz onto its runs, so both must come through.
    expect(typeof fmt!.fontFamily, `got ${JSON.stringify(fmt)}`).toBe('string');
    expect(fmt!.fontSizeHalfPoints).toBeGreaterThan(0);

    editor.destroy();
    body.remove();
  });
});

// `getDocumentFonts` derives the real inventory. The fixture's own description names the
// families it uses, so this asserts against the document rather than a fixed list.
describe('getDocumentFonts derives the real inventory', () => {
  test('reports the families the fixture actually carries', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const fixture = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({ host: hostWith(body), document: new Uint8Array(readFileSync(fixture)) });

    const fonts = editor.getDocumentFonts();
    expect(fonts.length, 'no fonts derived from a document that names five').toBeGreaterThan(1);
    // De-duplicated: a family used by many runs appears once.
    expect(new Set(fonts).size).toBe(fonts.length);
    // The fixture's "Font Variations" section lists these; at least one must come through.
    expect(fonts.some((f) => ['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana'].includes(f)),
      `derived: ${JSON.stringify(fonts)}`).toBe(true);

    editor.destroy();
    body.remove();
  });
});

// `getDocumentStyles` reports the document's own style table.
describe('getDocumentStyles derives the real style table', () => {
  test('reports paragraph styles the fixture defines, and only paragraph styles', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const fixture = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({ host: hostWith(body), document: new Uint8Array(readFileSync(fixture)) });

    const styles = editor.getDocumentStyles();
    expect(styles.length, 'no styles derived from a document with headings').toBeGreaterThan(1);
    // The picker offers paragraph styles only; a character style there would apply
    // something the control cannot express.
    expect(styles.every((s) => s.type === 'paragraph')).toBe(true);
    // Every row is renderable — no blank names.
    expect(styles.every((s) => s.name.length > 0 && s.styleId.length > 0)).toBe(true);
    // A document with H1-H5 must surface at least one heading style.
    expect(styles.some((s) => /heading/i.test(s.styleId) || /heading/i.test(s.name)),
      `derived: ${JSON.stringify(styles.slice(0, 8))}`).toBe(true);

    editor.destroy();
    body.remove();
  });
});

// `getOutline` follows the legacy heading rule: styleId `Heading<n>` gives level n-1,
// bounded 0..8, text trimmed, empty headings skipped.
describe('getOutline derives real headings', () => {
  test('reports the fixture headings in document order with correct levels', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const fixture = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({ host: hostWith(body), document: new Uint8Array(readFileSync(fixture)) });

    const outline = editor.getOutline();
    expect(outline.length, 'no headings from a document with H1-H5').toBeGreaterThan(2);
    // Every entry is renderable and addressable.
    expect(outline.every((h) => h.text.trim().length > 0 && h.blockId.length > 0)).toBe(true);
    // Levels stay in the legacy range.
    expect(outline.every((h) => h.level >= 0 && h.level <= 8)).toBe(true);
    // The fixture has H1 through H5, so more than one distinct level must appear —
    // a flat outline would mean the level derivation is not working.
    expect(new Set(outline.map((h) => h.level)).size,
      `levels: ${JSON.stringify(outline.slice(0, 6))}`).toBeGreaterThan(1);

    editor.destroy();
    body.remove();
  });
});

// `findMatches` searches canonical text with the legacy semantics.
describe('findMatches searches the canonical model', () => {
  test('finds real occurrences and honours case and whole-word', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const fixture = path.resolve(import.meta.dir, '../../../e2e/fixtures/comprehensive-word-element-test.docx');
    const body = document.createElement('div');
    document.body.append(body);
    const editor = createEditor({ host: hostWith(body), document: new Uint8Array(readFileSync(fixture)) });

    // An empty query matches nothing, rather than every position.
    expect(editor.findMatches('')).toEqual([]);

    const hits = editor.findMatches('Heading');
    expect(hits.length, 'no matches for a word the fixture repeats').toBeGreaterThan(2);
    expect(hits.every((h) => h.blockId.length > 0 && h.length === 'Heading'.length)).toBe(true);

    // Case-insensitive by default, so lowercase finds the same occurrences.
    expect(editor.findMatches('heading').length).toBe(hits.length);
    // With matchCase, the lowercase query must find strictly fewer.
    expect(editor.findMatches('heading', { matchCase: true }).length).toBeLessThan(hits.length);

    // Whole-word: a fragment matches loosely but not as a word.
    expect(editor.findMatches('eadin').length).toBeGreaterThan(0);
    expect(editor.findMatches('eadin', { wholeWord: true })).toEqual([]);

    // Regex metacharacters are escaped — this is a literal search surface.
    expect(editor.findMatches('.*')).toEqual([]);

    editor.destroy();
    body.remove();
  });
});
