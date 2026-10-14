// The anonymous detail of a failure: the engine reason, the role of the part, the class of an
// exception, and the kind of a skipped tracked change. Each test checks that the detail is there
// and that the strings the fixture planted, the text, part names and messages, are not.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import type { EditorDiagnostic } from '../../contracts/diagnostics.ts';
import { createDocxEditor } from '../docx-editor.ts';
import { stubReviewModule } from './review-test-module.ts';
import {
  diagnosticCause,
  diagnosticCauses,
  diagnosticErrorName,
  documentPartKind,
  formattingChangeKind,
} from '../../automation/diagnostic-context.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

const SECRET_TEXT = 'Confidential settlement terms';
const SECRET_PART = 'client-matter-4471';

function docx(body: string, mainPart = 'word/document.xml'): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Override PartName="/${mainPart}" ContentType="${MAIN}"/></Types>`
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="${mainPart}"/></Relationships>`
    ),
    [mainPart]: strToU8(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
  });
}

const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

function observe() {
  const events: EditorDiagnostic[] = [];
  return {
    events,
    module: { id: 'detail', onDiagnostic: (event: EditorDiagnostic) => events.push(event) },
  };
}

function mount() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

/** The serialized events, which must never hold a planted string. */
function expectNoSecrets(events: readonly EditorDiagnostic[]): void {
  const text = JSON.stringify(events);
  for (const secret of [SECRET_TEXT, SECRET_PART, 'document.xml'])
    expect(text).not.toContain(secret);
}

describe('open failures', () => {
  test('a malformed part reports the engine reason and the part role, never its name', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({ container: mount(), modules: [module] });
    try {
      // `q:` has no namespace declaration.
      editor.load(docx(`<w:p><q:x/></w:p>${paragraph(SECRET_TEXT)}`));
      expect(events.find((event) => event.kind === 'document.open')).toMatchObject({
        outcome: 'rejected',
        code: 'open.xml-malformed',
        cause: 'undeclared-prefix',
        part: 'main-document',
      });
      expectNoSecrets(events);
    } finally {
      editor.destroy();
    }
  });

  test('a part under a name outside the standard layout reports the role other', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({ container: mount(), modules: [module] });
    try {
      editor.load(docx(`<w:p><q:x/></w:p>`, `word/${SECRET_PART}.xml`));
      expect(events.find((event) => event.kind === 'document.open')).toMatchObject({
        code: 'open.xml-malformed',
        part: 'other',
      });
      expectNoSecrets(events);
    } finally {
      editor.destroy();
    }
  });

  test('an open that throws reports open.failed with the class of the error, not its message', () => {
    const { events, module } = observe();
    const container = mount();
    const fail = () => {
      throw new TypeError(`cannot place ${SECRET_TEXT}`);
    };
    container.appendChild = fail;
    container.append = fail;
    container.replaceChildren = fail;
    container.insertBefore = fail;
    let editor: ReturnType<typeof createDocxEditor> | undefined;
    expect(() => {
      editor = createDocxEditor({
        container,
        document: docx(paragraph(SECRET_TEXT)),
        modules: [module],
      });
    }).toThrow(TypeError);
    editor?.destroy();
    expect(events.filter((event) => event.kind === 'document.open')).toEqual([
      expect.objectContaining({
        outcome: 'rejected',
        code: 'open.failed',
        cause: 'exception',
        errorName: 'TypeError',
      }),
    ]);
    expectNoSecrets(events);
  });
});

describe('command failures', () => {
  test('a command that throws reports edit.internal-invariant with the class, then rethrows', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({
      container: mount(),
      document: docx(paragraph('a')),
      modules: [module],
    });
    try {
      const command = {
        type: 'insertText',
        get text(): string {
          throw new RangeError(`bad text ${SECRET_TEXT}`);
        },
      } as unknown as Parameters<typeof editor.exec>[0];
      expect(() => editor.exec(command)).toThrow(RangeError);
      expect(events.filter((event) => event.kind === 'edit.rejected')).toEqual([
        expect.objectContaining({
          code: 'edit.internal-invariant',
          origin: 'command',
          command: 'insertText',
          cause: 'exception',
          errorName: 'RangeError',
        }),
      ]);
      expectNoSecrets(events);
    } finally {
      editor.destroy();
    }
  });
});

/** A paragraph-mark formatting change with no author: the engine cannot resolve it. */
const UNADDRESSED_FORMAT =
  '<w:p><w:pPr><w:rPr><w:b/>' +
  '<w:rPrChange w:id="7" w:date="2026-01-02T00:00:00Z"><w:rPr/></w:rPrChange>' +
  '</w:rPr></w:pPr>' +
  `<w:ins w:id="9" w:author="${SECRET_PART}" w:date="2026-01-01T00:00:00Z">` +
  `<w:r><w:t>${SECRET_TEXT}</w:t></w:r></w:ins></w:p>`;

describe('skipped tracked changes', () => {
  test('an accept that skips a change reports the operation, the kind and the part role', () => {
    const { events, module } = observe();
    const body = UNADDRESSED_FORMAT;
    const editor = createDocxEditor({
      container: mount(),
      document: docx(body),
      modules: [stubReviewModule(), module],
    });
    try {
      editor.exec({ type: 'resolveAllReviewChanges', action: 'accept', scope: 'document' });
      const skipped = events.filter((event) => event.kind === 'review.skipped');
      expect(skipped).toEqual([
        expect.objectContaining({
          code: 'review.revision-unsupported',
          count: 1,
          operation: 'accept',
          changeKind: 'format',
          formattingKind: 'rPrChange',
          part: 'main-document',
          // The change has no author, so the engine cannot address it.
          cause: 'unaddressed',
        }),
      ]);
      expectNoSecrets(events);
    } finally {
      editor.destroy();
    }
  });

  test('a marker where content cannot be reports misplaced-marker, not the generic reason', () => {
    const { events, module } = observe();
    // An insertion marker inside a run, where only run content can be.
    const body =
      `<w:p><w:r><w:ins w:id="5" w:author="${SECRET_PART}">` +
      `<w:t>${SECRET_TEXT}</w:t></w:ins></w:r></w:p>`;
    const editor = createDocxEditor({
      container: mount(),
      document: docx(body),
      modules: [stubReviewModule(), module],
    });
    try {
      editor.exec({ type: 'resolveAllReviewChanges', action: 'accept', scope: 'document' });
      expect(events.filter((event) => event.kind === 'review.skipped')).toEqual([
        expect.objectContaining({
          code: 'review.revision-unsupported',
          operation: 'accept',
          cause: 'misplaced-marker',
        }),
      ]);
      expectNoSecrets(events);
    } finally {
      editor.destroy();
    }
  });

  test('a reject from a review card that names an unknown change is reported once', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({
      container: mount(),
      document: docx(paragraph('a')),
      modules: [stubReviewModule(), module],
    });
    try {
      expect(editor.rejectReviewItem(`ins:${SECRET_PART}:404`).ok).toBe(false);
      expect(events.filter((event) => event.kind === 'review.skipped')).toEqual([
        expect.objectContaining({ code: 'review.stale-revision', count: 1, operation: 'reject' }),
      ]);
      expectNoSecrets(events);
    } finally {
      editor.destroy();
    }
  });

  test('a reject that names an unknown change reports the operation and no kind', () => {
    const { events, module } = observe();
    const editor = createDocxEditor({
      container: mount(),
      document: docx(paragraph('a')),
      modules: [stubReviewModule(), module],
    });
    try {
      editor.exec({
        type: 'resolveAllReviewChanges',
        action: 'reject',
        keys: [`ins:${SECRET_PART}:1`],
      });
      expect(events.filter((event) => event.kind === 'review.skipped')).toEqual([
        expect.objectContaining({ code: 'review.stale-revision', count: 1, operation: 'reject' }),
      ]);
      const [event] = events.filter((item) => item.kind === 'review.skipped');
      expect(event && 'changeKind' in event).toBe(false);
      expectNoSecrets(events);
    } finally {
      editor.destroy();
    }
  });
});

describe('context helpers', () => {
  test('part roles come from the standard layout; any other name is other', () => {
    expect(documentPartKind('word/header2.xml')).toBe('header');
    expect(documentPartKind('/word/footer1.xml: missing attribute')).toBe('footer');
    // A relationship is reported by the part that owns it.
    expect(documentPartKind('word/document.xml/rId4 -> ../x: escapes')).toBe('main-document');
    expect(documentPartKind('word/_rels/header1.xml.rels')).toBe('relationships');
    expect(documentPartKind('[Content_Types].xml')).toBe('content-types');
    expect(documentPartKind('word/theme/theme1.xml')).toBe('theme');
    expect(documentPartKind('word/commentsExtended.xml')).toBe('comments');
    expect(documentPartKind('word/glossary/document.xml')).toBe('glossary');
    expect(documentPartKind(`word/${SECRET_PART}.xml`)).toBe('other');
    expect(documentPartKind(`${'a/'.repeat(400)}document.xml`)).toBe('other');
    expect(documentPartKind(undefined)).toBeUndefined();
  });

  test('a cause is an engine token; sentences, details and prototype keys never pass', () => {
    expect(diagnosticCause('undeclared-prefix')).toBe('undeclared-prefix');
    expect(diagnosticCause(`unsupported-revision:${SECRET_PART}`)).toBe('unsupported-revision');
    expect(diagnosticCause('split-not-clean')).toBe('split-not-clean');
    expect(diagnosticCause(`a sentence about ${SECRET_TEXT}`)).toBeUndefined();
    expect(diagnosticCause('constructor')).toBeUndefined();
    expect(diagnosticCause('__proto__')).toBeUndefined();
    for (const cause of diagnosticCauses()) expect(cause).toMatch(/^[a-zA-Z][a-zA-Z-]{1,63}$/);
  });

  test('an error reports its built-in class only; a custom name reports other', () => {
    expect(diagnosticErrorName(new TypeError(SECRET_TEXT))).toBe('TypeError');
    class SecretError extends Error {
      override name = SECRET_PART;
    }
    expect(diagnosticErrorName(new SecretError())).toBe('other');
    expect(diagnosticErrorName(SECRET_TEXT)).toBe('other');
  });

  test('a formatting change outside the known elements reports other', () => {
    expect(formattingChangeKind('pPrChange')).toBe('pPrChange');
    expect(formattingChangeKind(SECRET_PART)).toBe('other');
    expect(formattingChangeKind(undefined)).toBeUndefined();
  });
});
