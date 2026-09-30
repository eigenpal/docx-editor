import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
import { expect, test } from 'bun:test';
import { createDocxEditor } from '../docx-editor.ts';
import { selectedImageStateOf } from '../docx-editor-images.ts';
import { textboxDocx } from './textbox-editing-fixture.ts';

test('textbox typing uses its story and supports undo', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    const surface = editor.surface!;
    const match = editor.findMatches('boxed needle')[0]!;
    expect(match.scope?.kind).toBe('frame');
    expect(surface.setActiveScope(match.scope!)).toBe(true);
    expect(editor.exec({ type: 'insertText', text: 'New ' }).ok).toBe(true);
    expect(editor.findMatches('New boxed needle')).toHaveLength(1);
    expect(editor.findMatches('body')).toHaveLength(1);
    expect(surface.activeScope().kind).toBe('frame');
    editor.exec({ type: 'undo' });
    expect(editor.findMatches('boxed needle')).toHaveLength(1);
    expect(editor.findMatches('New ')).toHaveLength(0);
    editor.exec({ type: 'redo' });
    expect(editor.findMatches('New boxed needle')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('textbox resize and position commands preserve its text', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    editor.selectMatch(match);
    const image = selectedImageStateOf(editor.surface!);
    expect(image).not.toBeNull();
    const resized = editor.exec({
      type: 'setImageProperties',
      widthEmu: 1828800,
      heightEmu: 914400,
    });
    expect(resized.ok).toBe(true);
    expect(selectedImageStateOf(editor.surface!)?.widthEmu).toBe(1828800);
    const moved = editor.exec({
      type: 'setImagePosition',
      horizontalEmu: 914400,
      verticalEmu: 914400,
      relativeToH: 'page',
      relativeToV: 'page',
    });
    expect(moved.ok).toBe(true);
    expect(editor.findMatches('boxed needle')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('textbox paragraph splits and saved edits remain inside the story', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    const surface = editor.surface!;
    surface.setActiveScope(match.scope!);
    surface.setSelection({
      anchor: { paragraphId: match.blockId, offset: 5 },
      head: { paragraphId: match.blockId, offset: 5 },
    });
    surface.splitParagraph();
    expect(surface.state().selection.head.paragraphId).not.toBe(match.blockId);
    editor.exec({ type: 'insertText', text: 'changed' });
    expect(editor.findMatches('changed needle')).toHaveLength(1);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await editor.save()),
    });
    try {
      expect(reopened.findMatches('changed needle')[0]?.scope?.kind).toBe('frame');
      expect(reopened.findMatches('body')).toHaveLength(1);
    } finally {
      reopened.destroy();
    }
  } finally {
    editor.destroy();
  }
});

test('leaving a textbox restores body input and viewing mode refuses entry', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    const surface = editor.surface!;
    const body = surface.state().selection;
    surface.setActiveScope(match.scope!);
    surface.setActiveScope({ kind: 'body' });
    expect(surface.state().selection).toEqual(body);
    surface.setActiveScope(match.scope!);
    surface.setEditingMode('view');
    expect(surface.setActiveScope(match.scope!)).toBe(false);
    expect(surface.activeScope().kind).toBe('body');
  } finally {
    editor.destroy();
  }
});

test('textbox geometry survives save and undo without changing body text', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    editor.selectMatch(editor.findMatches('boxed needle')[0]!);
    expect(
      editor.exec({
        type: 'setImagePosition',
        horizontalEmu: 127000,
        verticalEmu: 254000,
        relativeToH: 'page',
        relativeToV: 'page',
      }).ok
    ).toBe(true);
    expect(selectedImageStateOf(editor.surface!)?.position?.horizontalEmu).toBe(127000);
    editor.exec({ type: 'undo' });
    expect(selectedImageStateOf(editor.surface!)?.position?.horizontalEmu).toBe(0);
    editor.exec({ type: 'redo' });
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await editor.save()),
    });
    try {
      reopened.selectMatch(reopened.findMatches('boxed needle')[0]!);
      expect(selectedImageStateOf(reopened.surface!)?.position?.horizontalEmu).toBe(127000);
      expect(selectedImageStateOf(reopened.surface!)?.position?.verticalEmu).toBe(254000);
      expect(reopened.findMatches('body')).toHaveLength(1);
    } finally {
      reopened.destroy();
    }
  } finally {
    editor.destroy();
  }
});

test('header textbox refuses editing and body selection leaves a textbox', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(true, true),
  });
  try {
    const matches = editor.findMatches('boxed needle');
    const bodyFrame = matches.find((m) => m.scope?.kind === 'frame' && !m.scope.owner)!;
    const headerFrame = matches.find((m) => m.scope?.kind === 'frame' && m.scope.owner)!;
    expect(editor.surface!.setActiveScope(headerFrame.scope!)).toBe(false);
    expect(editor.surface!.setActiveScope(bodyFrame.scope!)).toBe(true);
    editor.selectMatch(editor.findMatches('body')[0]!);
    expect(editor.surface!.activeScope().kind).toBe('body');
    expect(editor.exec({ type: 'insertText', text: 'replaced' }).ok).toBe(true);
    expect(editor.findMatches('boxed needle')).toHaveLength(2);
  } finally {
    editor.destroy();
  }
});

test('select all and replacement stay within the active textbox', () => {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: textboxDocx() });
  try {
    const surface = editor.surface!;
    const match = editor.findMatches('boxed needle')[0]!;
    surface.setActiveScope(match.scope!);
    expect(surface.canInsertTable(2, 2)).toBe(false);
    surface.selectAll();
    expect(surface.selectedText()).toBe('boxed needle');
    expect(editor.exec({ type: 'insertText', text: 'replacement' }).ok).toBe(true);
    expect(editor.findMatches('replacement')[0]?.scope?.kind).toBe('frame');
    expect(editor.findMatches('body')).toHaveLength(1);
    expect(container.querySelector('.docx-drawing-textbox')?.getAttribute('role')).toBe('textbox');
    surface.setEditable(false);
    expect(surface.activeScope().kind).toBe('body');
    expect(surface.setActiveScope(match.scope!)).toBe(false);
  } finally {
    editor.destroy();
  }
});

test('textbox paste uses plain text without inserting unsupported table content', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    const surface = editor.surface!;
    surface.setActiveScope(editor.findMatches('boxed needle')[0]!.scope!);
    expect(surface.pasteRich('pasted ', '<table><tr><td>pasted</td></tr></table>')).toBe(true);
    expect(editor.findMatches('pasted boxed needle')[0]?.scope?.kind).toBe('frame');
    expect(editor.findMatches('body')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('a textbox border selects its drawing on the first press outside the body column', () => {
  const container = document.createElement('div');
  const editor = createDocxEditor({ container, document: textboxDocx() });
  try {
    const box = container.querySelector('.docx-drawing-textbox')!;
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 1,
      clientY: 1,
    });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(selectedImageStateOf(editor.surface!)?.id).toBe(
      box.getAttribute('data-drawing-node-id')
    );
    expect(editor.surface!.activeScope().kind).toBe('body');
  } finally {
    editor.destroy();
  }
});

test('a native empty-paragraph selection echo keeps the explicitly selected textbox', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: textboxDocx(false, true, 0, 2) });
  try {
    const match = editor.findMatches('boxed needle')[1]!;
    expect(editor.selectMatch(match).ok).toBe(true);
    const before = editor.surface!.state().selection;
    expect(before.head.offset).toBe(1);
    const host = container.querySelector(`[data-paragraph-id="${before.head.paragraphId}"]`)!;
    await Promise.resolve();
    document.getSelection()!.collapse(host, 0);
    document.dispatchEvent(new Event('selectionchange'));
    expect(editor.surface!.state().selection).toEqual(before);
    expect(selectedImageStateOf(editor.surface!)?.id).toBe(
      match.scope?.kind === 'frame' ? match.scope.drawingNodeId : null
    );
  } finally {
    editor.destroy();
    container.remove();
  }
});

test('deleting a selected textbox removes its compatibility atom and supports undo and save', async () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    editor.selectMatch(editor.findMatches('boxed needle')[0]!);
    expect(editor.exec({ type: 'deleteImage' }).ok).toBe(true);
    expect(editor.findMatches('boxed needle')).toHaveLength(0);
    expect(editor.findMatches('body')).toHaveLength(1);
    const reopened = createDocxEditor({
      container: document.createElement('div'),
      document: new Uint8Array(await editor.save()),
    });
    try {
      expect(reopened.findMatches('boxed needle')).toHaveLength(0);
    } finally {
      reopened.destroy();
    }
    editor.exec({ type: 'undo' });
    expect(editor.findMatches('boxed needle')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('multiline paste leaves the caret after the last pasted textbox paragraph', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    const surface = editor.surface!;
    surface.setActiveScope(editor.findMatches('boxed needle')[0]!.scope!);
    surface.selectAll();
    expect(surface.pasteRich('First\nSecond', null)).toBe(true);
    expect(editor.exec({ type: 'insertText', text: '!' }).ok).toBe(true);
    expect(editor.findMatches('Second!')[0]?.scope?.kind).toBe('frame');
    expect(editor.findMatches('body')).toHaveLength(1);
    editor.exec({ type: 'undo' });
    editor.exec({ type: 'undo' });
    expect(editor.findMatches('boxed needle')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('replacing all textbox text keeps its authored font and size', () => {
  const files = unzipSync(textboxDocx());
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '<w:t>boxed needle',
      '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="32"/></w:rPr><w:t>boxed needle'
    )
  );
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: zipSync(files),
  });
  try {
    const surface = editor.surface!;
    surface.setActiveScope(editor.findMatches('boxed needle')[0]!.scope!);
    surface.selectAll();
    surface.pasteRich('Replacement', null);
    const fragment = surface.layout().pages[0]!.anchoredDrawings![0]!.textboxStory!.fragments[0]!;
    expect(fragment.kind).toBe('paragraph');
    if (fragment.kind === 'paragraph') {
      expect(fragment.lines[0]!.spans[0]!.style.fontFamily).toBe('Arial');
      expect(fragment.lines[0]!.spans[0]!.style.fontSizePt).toBe(16);
    }
  } finally {
    editor.destroy();
  }
});

test('context-menu deletion removes the selected textbox and undo restores it', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    editor.selectMatch(editor.findMatches('boxed needle')[0]!);
    expect(editor.can({ type: 'deleteText' }).ok).toBe(true);
    expect(editor.exec({ type: 'deleteText' }).ok).toBe(true);
    expect(editor.findMatches('boxed needle')).toHaveLength(0);
    editor.exec({ type: 'undo' });
    expect(editor.findMatches('boxed needle')).toHaveLength(1);
    expect(editor.findMatches('body')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('textbox metadata is editable and unsupported picture operations are refused', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(),
  });
  try {
    editor.selectMatch(editor.findMatches('boxed needle')[0]!);
    expect(
      editor.exec({ type: 'setImageProperties', title: 'Text box', description: 'Example content' })
        .ok
    ).toBe(true);
    expect(selectedImageStateOf(editor.surface!)?.description).toBe('Example content');
    expect(editor.can({ type: 'transformImage', action: 'rotateCW' }).ok).toBe(false);
    expect(editor.can({ type: 'setImageProperties', hyperlink: 'https://example.com' }).ok).toBe(
      false
    );
    expect(editor.findMatches('boxed needle')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});

test('textbox boundary deletion never joins the body or another textbox', () => {
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: textboxDocx(false, true, 0, 2),
  });
  try {
    const surface = editor.surface!;
    const matches = editor.findMatches('boxed needle');
    expect(matches).toHaveLength(2);
    surface.setActiveScope(matches[0]!.scope!);
    surface.deleteBackward();
    const end = { paragraphId: matches[0]!.blockId, offset: 'boxed needle'.length };
    surface.setSelection({ anchor: end, head: end });
    surface.deleteForward();
    expect(editor.findMatches('boxed needle')).toHaveLength(2);
    expect(editor.findMatches('body')).toHaveLength(1);
    surface.setActiveScope(matches[1]!.scope!);
    editor.exec({ type: 'insertText', text: 'Second ' });
    expect(editor.findMatches('Second boxed needle')).toHaveLength(1);
    expect(surface.activeScope()).toEqual(matches[1]!.scope!);
  } finally {
    editor.destroy();
  }
});

test('rotated textbox text remains read-only', () => {
  const files = unzipSync(textboxDocx());
  files['word/document.xml'] = strToU8(
    strFromU8(files['word/document.xml']!).replace(
      '<wps:spPr>',
      '<wps:spPr><a:xfrm rot="5400000"/>'
    )
  );
  const editor = createDocxEditor({
    container: document.createElement('div'),
    document: zipSync(files),
  });
  try {
    const match = editor.findMatches('boxed needle')[0]!;
    expect(editor.surface!.setActiveScope(match.scope!)).toBe(false);
    expect(editor.surface!.activeScope().kind).toBe('body');
    expect(editor.findMatches('boxed needle')).toHaveLength(1);
  } finally {
    editor.destroy();
  }
});
