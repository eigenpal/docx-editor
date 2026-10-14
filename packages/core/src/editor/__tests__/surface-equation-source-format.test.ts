import { expect, test } from 'bun:test';
import { readOoxmlPart, serializeOoxmlPart } from '@docx-editor.dev/core/store';
import { createEquationOps, type EquationOpsDeps } from '../surface-equations.ts';

const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const MATH = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const run = (properties = '') => `<m:r>${properties}<m:t>Q</m:t></m:r>`;
const cases = [
  ['plain', run(), false],
  ['font', run('<w:rPr><w:rFonts w:ascii="Public Math" w:hAnsi="Public Math"/></w:rPr>'), true],
  ['literal', run('<m:rPr><m:lit/></m:rPr>'), true],
  ['normal', run('<m:rPr><m:nor/></m:rPr>'), true],
  ['bar', `<m:bar><m:e>${run()}</m:e></m:bar>`, true],
  ['unknown', '<m:unknown/>', false],
] as const;

for (const [name, body, protectedSource] of cases) {
  test(`compact replacement preserves ${name} source before tree writes`, () => {
    const parsed = readOoxmlPart(
      `<w:document xmlns:w="${WORD}" xmlns:m="${MATH}"><w:body><w:p>` +
        `<w:r><w:t xml:space="preserve">Left </w:t></w:r><m:oMath>${body}</m:oMath>` +
        '<w:r><w:t xml:space="preserve"> right</w:t></w:r></w:p></w:body></w:document>',
      { name: '/word/document.xml', contentType: 'application/xml' }
    );
    if (!parsed.ok) throw new Error('Public canonical fixture did not parse');
    const paragraph = parsed.part.root.children
      .find((node) => node.kind === 'body')
      ?.children.find((node) => node.kind === 'paragraph');
    if (!paragraph) throw new Error('Missing public paragraph');
    const before = serializeOoxmlPart(parsed.part);
    const position = { paragraphId: paragraph.id, offset: 5 };
    let writes = 0;
    let writeRefusals = 0;
    let mode: 'edit' | 'suggest' | 'view' = 'edit';
    const commits: unknown[] = [];
    const session = {
      partFor: () => parsed.part,
      storyParts: () => [parsed.part],
      applyTreeOps: () => {
        writes++;
        return { committed: true };
      },
    } as unknown as EquationOpsDeps['session'];
    const ops = createEquationOps({
      session,
      storyScope: () => ({ kind: 'body' }),
      editingMode: () => mode,
      writeRefusal: () => {
        writeRefusals++;
        return null;
      },
      selection: () => ({ anchor: position, head: position }),
      selectionMark: () => null,
      commit: (execute) => {
        commits.push(execute());
      },
    });
    const equation = ops.equationsInCaretParagraph()[0];
    if (!equation) throw new Error('Missing real canonical equation');
    expect(ops.can(equation.id, 'replace').ok).toBe(!protectedSource);
    expect(ops.applyEquation(equation.id, 'R')).toBe(!protectedSource);
    expect(writes).toBe(protectedSource ? 0 : 1);
    if (protectedSource) {
      expect(writeRefusals).toBe(0);
      expect(commits).toEqual([
        {
          committed: false,
          rejected: true,
          opCount: 0,
          reason: 'compact linear editing cannot preserve this equation source formatting',
        },
      ]);
    }
    expect(ops.can(equation.id, 'remove').ok).toBe(true);
    mode = 'suggest';
    expect(ops.can(equation.id, 'replace').ok).toBe(false);
    expect(ops.can(equation.id, 'remove').ok).toBe(false);
    expect(serializeOoxmlPart(parsed.part)).toEqual(before);
  });
}
