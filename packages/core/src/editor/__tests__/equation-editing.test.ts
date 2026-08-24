import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import { createDocxEditor } from '../docx-editor.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function docx(): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(`<Relationships xmlns="${REL}"/>`),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:m="${M}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r>' +
        '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>' +
        '<w:r><w:t>Z</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    ),
  });
}

function mounted(author?: string) {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({
    container,
    document: docx(),
    ...(author ? { author } : {}),
  });
  if (!editor.surface) throw new Error('surface failed to mount');
  const paragraphId = '/word/document.xml#0.0.0';
  editor.surface.setSelection({
    anchor: { paragraphId, offset: 1 },
    head: { paragraphId, offset: 1 },
  });
  return { editor, paragraphId, container };
}

describe('atomic equation editing', () => {
  test('discovers and replaces the equation at the caret', () => {
    const { editor } = mounted();
    const equation = editor.surface!.equations.equationAtCaret();
    expect(equation).toMatchObject({ start: 1, end: 2, linear: 'x' });
    expect(editor.surface!.equations.applyEquation(equation!.id, '{a+b}/{2}')).toBe(true);
    expect(editor.surface!.session.bodyText()).toBe('A\uFFFCZ');
    expect(editor.surface!.equations.equationById(equation!.id)?.linear).toBe('{a+b}/{2}');
  });

  test('replace and remove are each one undo step', () => {
    const { editor, paragraphId } = mounted();
    const equation = editor.surface!.equations.equationAtCaret()!;
    editor.surface!.equations.applyEquation(equation.id, 'x^2');
    editor.exec({ type: 'undo' });
    editor.surface!.setSelection({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 1 },
    });
    expect(editor.surface!.equations.equationAtCaret()?.linear).toBe('x');

    expect(editor.surface!.equations.removeEquation(equation.id)).toBe(true);
    expect(editor.surface!.session.bodyText()).toBe('AZ');
    editor.exec({ type: 'undo' });
    expect(editor.surface!.session.bodyText()).toBe('A\uFFFCZ');
  });

  test('refuses malformed input without changing the equation', () => {
    const { editor } = mounted();
    const equation = editor.surface!.equations.equationAtCaret()!;
    expect(editor.surface!.equations.applyEquation(equation.id, 'x^')).toBe(false);
    expect(editor.surface!.equations.equationById(equation.id)?.linear).toBe('x');
  });

  test('refuses replace and remove while suggesting without an untracked edit', () => {
    const { editor } = mounted('Revision Author');
    const surface = editor.surface!;
    const equation = surface.equations.equationAtCaret()!;
    const reason = 'equation replacement and removal are not supported in suggesting mode';
    const revision = surface.session.packageRevision();
    surface.setEditingMode('suggest');

    expect(surface.equations.can(equation.id, 'replace')).toEqual({
      ok: false,
      code: 'unsupported',
      reason,
    });
    expect(surface.equations.can(equation.id, 'remove')).toEqual({
      ok: false,
      code: 'unsupported',
      reason,
    });
    expect(surface.equations.applyEquation(equation.id, 'x^2')).toBe(false);
    expect(surface.equations.removeEquation(equation.id)).toBe(false);

    expect(surface.session.packageRevision()).toBe(revision);
    expect(surface.equations.equationById(equation.id)?.linear).toBe('x');
    expect(surface.session.bodyText()).toBe('A\uFFFCZ');
    expect(surface.state().lastRejection).toBe(reason);
  });

  test('does not invalidate layout for unchanged supported math', () => {
    const { editor } = mounted();
    const equation = editor.surface!.equations.equationAtCaret()!;
    const revision = editor.surface!.session.packageRevision();
    expect(editor.surface!.equations.applyEquation(equation.id, equation.linear)).toBe(true);
    expect(editor.surface!.session.packageRevision()).toBe(revision);
  });

  test('a painted equation click selects its atom and requests chrome', () => {
    const { editor, paragraphId, container } = mounted();
    const seen: string[] = [];
    editor.setEquationChrome({
      onPopover: (activation) => seen.push(activation.equation.id),
    });
    const equation = editor.surface!.equations.equationAtCaret()!;
    const painted = container.querySelector<HTMLElement>('[data-docx-equation]')!;
    painted.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(seen).toEqual([equation.id]);
    expect(editor.surface!.state().selection).toEqual({
      anchor: { paragraphId, offset: 1 },
      head: { paragraphId, offset: 2 },
    });
  });

  test('a press survives the selection repaint before click activation', () => {
    const { editor, container } = mounted();
    const seen: string[] = [];
    editor.setEquationChrome({
      onPopover: (activation) => seen.push(activation.equation.id),
    });
    const equation = editor.surface!.equations.equationAtCaret()!;
    const painted = container.querySelector<HTMLElement>('[data-docx-equation]')!;
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;

    painted.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    painted.remove();
    pages.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(seen).toEqual([equation.id]);
  });
});
