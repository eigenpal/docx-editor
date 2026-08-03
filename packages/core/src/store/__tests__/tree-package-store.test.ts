// Package-aware story mutation foundation for scoped header/footer editing.
//
// Pins: body + HF stores coexist with independent revisions; HF edits publish one
// ModelChange with `global` impact; save/reopen preserves the edited part; shared parts
// are one canonical tree; dangling/wrong rIds fail closed; story-store count is bounded.

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { paragraphTextOf } from '../store/tree-ops.ts';
import {
  DEFAULT_MAX_EDITABLE_STORY_PARTS,
  TreePackageStore,
  type StoryScope,
  type TreeModelChange,
} from '../store/tree-package-store.ts';
import { readOoxmlPackage, writeOoxmlPackage } from '../package/ooxml-package.ts';
import { resolveHeaderFooterPartsBySection } from '../package/hf-references.ts';
import { openTreeSession } from '../../binding/tree-session.ts';
import type { OoxmlNode, OoxmlPart } from '../package/ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = `${R}/officeDocument`;

function build(options: {
  readonly body?: string;
  readonly references?: string;
  readonly secondSectPr?: string;
  readonly rels?: string;
  readonly headerParts?: Record<string, string>;
  readonly overrides?: string;
}): Uint8Array {
  const body =
    options.body ??
    (options.secondSectPr
      ? `<w:p><w:pPr><w:sectPr>${options.references ?? ''}</w:sectPr></w:pPr><w:r><w:t>one</w:t></w:r></w:p>` +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>' +
        `<w:sectPr>${options.secondSectPr}</w:sectPr>`
      : '<w:p><w:r><w:t>body</w:t></w:r></w:p>' +
        `<w:sectPr>${options.references ?? ''}</w:sectPr>`);
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (options.overrides ?? '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}</w:body></w:document>`
    ),
  };
  if (options.rels) {
    entries['word/_rels/document.xml.rels'] = strToU8(
      `<Relationships xmlns="${REL}">${options.rels}</Relationships>`
    );
  }
  for (const [name, xml] of Object.entries(options.headerParts ?? {})) {
    entries[name] = strToU8(xml);
  }
  return zipSync(entries);
}

const HEADER_XML = (text: string): string =>
  `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`;
const FOOTER_XML = (text: string): string =>
  `<w:ftr xmlns:w="${W}"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:ftr>`;
const HEADER_OVERRIDE =
  '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>';
const FOOTER_OVERRIDE =
  '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>';

function loadPackage(bytes: Uint8Array) {
  const result = readOoxmlPackage(bytes);
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

function openPackage(bytes: Uint8Array, options?: { maxEditableStoryParts?: number }) {
  const pkg = loadPackage(bytes);
  const main = pkg.parts.get(pkg.mainDocumentPart);
  if (!main) throw new Error('no main');
  return new TreePackageStore(pkg, main, options);
}

function paragraphIds(part: OoxmlPart): string[] {
  const ids: string[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'paragraph') ids.push(node.id);
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return ids;
}

const sharedHeaderDoc = (): Uint8Array =>
  build({
    references: '<w:headerReference w:type="default" r:id="rId7"/>',
    secondSectPr: '<w:headerReference w:type="default" r:id="rId7"/>',
    rels: `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>`,
    headerParts: { 'word/header1.xml': HEADER_XML('SHARED') },
    overrides: HEADER_OVERRIDE,
  });

const bodyAndHeaderDoc = (): Uint8Array =>
  build({
    references:
      '<w:headerReference w:type="default" r:id="rId7"/>' +
      '<w:footerReference w:type="default" r:id="rId8"/>',
    rels:
      `<Relationship Id="rId7" Type="${R}/header" Target="header1.xml"/>` +
      `<Relationship Id="rId8" Type="${R}/footer" Target="footer1.xml"/>`,
    headerParts: {
      'word/header1.xml': HEADER_XML('HEADER'),
      'word/footer1.xml': FOOTER_XML('FOOTER'),
    },
    overrides: HEADER_OVERRIDE + FOOTER_OVERRIDE,
  });

describe('TreePackageStore — body and HF coexistence', () => {
  test('body and header stores keep independent revisions and indexes', () => {
    const store = openPackage(bodyAndHeaderDoc());
    const bodyScope: StoryScope = { kind: 'body' };
    const headerScope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };

    const bodyPart = store.partFor(bodyScope)!;
    const headerPart = store.partFor(headerScope)!;
    const bodyId = paragraphIds(bodyPart)[0]!;
    const headerId = paragraphIds(headerPart)[0]!;

    expect(store.revisionFor(bodyScope)).toBe(0);
    expect(store.revisionFor(headerScope)).toBe(0);

    const bodyResult = store.transact(bodyScope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: bodyId, offset: 4, text: '!' });
    });
    expect(bodyResult.ok).toBe(true);
    expect(store.revisionFor(bodyScope)).toBe(1);
    expect(store.revisionFor(headerScope)).toBe(0);
    expect(paragraphTextOf(store.partFor(bodyScope)!, bodyId)).toBe('body!');
    expect(paragraphTextOf(store.partFor(headerScope)!, headerId)).toBe('HEADER');

    const headerResult = store.transact(headerScope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 6, text: 'X' });
    });
    expect(headerResult.ok).toBe(true);
    expect(store.revisionFor(bodyScope)).toBe(1);
    expect(store.revisionFor(headerScope)).toBe(1);
    expect(paragraphTextOf(store.partFor(bodyScope)!, bodyId)).toBe('body!');
    expect(paragraphTextOf(store.partFor(headerScope)!, headerId)).toBe('HEADERX');
  });

  test('an HF transaction publishes one ModelChange with global impact and one undo unit', () => {
    const store = openPackage(bodyAndHeaderDoc());
    const headerScope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    const headerId = paragraphIds(store.partFor(headerScope)!)[0]!;
    const changes: TreeModelChange[] = [];
    store.subscribe((change) => changes.push(change));

    const result = store.transact(headerScope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 0, text: 'A' });
      ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 1, text: 'B' });
    });

    expect(result.ok).toBe(true);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.impact).toBe('global');
    expect(changes[0]!.story).toEqual({
      kind: 'headerFooter',
      partName: '/word/header1.xml',
      rId: 'rId7',
    });
    expect(store.canUndo).toBe(true);

    store.undo();
    expect(paragraphTextOf(store.partFor(headerScope)!, headerId)).toBe('HEADER');
    expect(changes).toHaveLength(2);
    expect(changes[1]!.impact).toBe('global');
    expect(changes[1]!.story?.kind).toBe('headerFooter');
  });

  test('currentPackage and save/reopen include the edited HF part', () => {
    const store = openPackage(bodyAndHeaderDoc());
    const headerScope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    const headerId = paragraphIds(store.partFor(headerScope)!)[0]!;
    store.transact(headerScope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 0, text: 'EDIT-' });
    });

    const live = store.currentPackage().parts.get('/word/header1.xml')!;
    expect(paragraphTextOf(live, headerId)).toBe('EDIT-HEADER');

    const reopened = loadPackage(writeOoxmlPackage(store.currentPackage()));
    const saved = reopened.parts.get('/word/header1.xml')!;
    const savedId = paragraphIds(saved)[0]!;
    expect(paragraphTextOf(saved, savedId)).toBe('EDIT-HEADER');
  });

  test('sections sharing one HF part see the same edited canonical part', () => {
    const store = openPackage(sharedHeaderDoc());
    const headerScope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    const headerId = paragraphIds(store.partFor(headerScope)!)[0]!;
    store.transact(headerScope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 0, text: 'NEW-' });
    });

    const bySection = resolveHeaderFooterPartsBySection(store.currentPackage());
    expect(bySection).toHaveLength(2);
    const first = bySection[0]!.headers.get('default')!;
    const second = bySection[1]!.headers.get('default')!;
    expect(first).toBe(second);
    expect(paragraphTextOf(first, headerId)).toBe('NEW-SHARED');
  });

  test('body edit does not advance the HF store revision', () => {
    const store = openPackage(bodyAndHeaderDoc());
    const bodyId = paragraphIds(store.partFor({ kind: 'body' })!)[0]!;
    store.resolveStory({ kind: 'headerFooter', rId: 'rId7' });
    const before = store.revisionFor({ kind: 'headerFooter', rId: 'rId7' });
    store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: bodyId, offset: 0, text: 'x' });
    });
    expect(store.revisionFor({ kind: 'headerFooter', rId: 'rId7' })).toBe(before);
    expect(store.revisionFor({ kind: 'body' })).toBe(1);
  });
});

describe('TreePackageStore — fail-closed targeting', () => {
  test('dangling and wrong-typed rIds are refused', () => {
    const store = openPackage(bodyAndHeaderDoc());

    const dangling = store.resolveStory({ kind: 'headerFooter', rId: 'rId99' });
    expect(dangling.ok).toBe(false);
    if (!dangling.ok) expect(dangling.reason).toBe('dangling-relationship');

    const wrong = store.transact({ kind: 'headerFooter', rId: 'rId1' }, () => {});
    expect(wrong.ok).toBe(false);

    const stylesAsHeader = openPackage(
      build({
        references: '<w:headerReference w:type="default" r:id="rId9"/>',
        rels: `<Relationship Id="rId9" Type="${R}/styles" Target="styles.xml"/>`,
        headerParts: {
          'word/styles.xml': `<w:styles xmlns:w="${W}"></w:styles>`,
        },
        overrides:
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      })
    );
    const wrongType = stylesAsHeader.resolveStory({ kind: 'headerFooter', rId: 'rId9' });
    expect(wrongType.ok).toBe(false);
    if (!wrongType.ok) expect(wrongType.reason).toBe('wrong-relationship-type');
  });

  test('opened story stores are bounded and fail closed', () => {
    const rels: string[] = [];
    const parts: Record<string, string> = {};
    let overrides = '';
    for (let i = 1; i <= 3; i += 1) {
      const id = `rId${i + 6}`;
      const name = `header${i}.xml`;
      rels.push(`<Relationship Id="${id}" Type="${R}/header" Target="${name}"/>`);
      parts[`word/${name}`] = HEADER_XML(`H${i}`);
      overrides += `<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`;
    }
    const store = openPackage(
      build({
        references: '<w:headerReference w:type="default" r:id="rId7"/>',
        rels: rels.join(''),
        headerParts: parts,
        overrides,
      }),
      { maxEditableStoryParts: 2 } // body + 1 HF
    );

    const first = store.resolveStory({ kind: 'headerFooter', rId: 'rId7' });
    expect(first.ok).toBe(true);
    expect(store.openedStoryCount()).toBe(2);

    const second = store.resolveStory({ kind: 'headerFooter', rId: 'rId8' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('too-many-story-stores');
    expect(DEFAULT_MAX_EDITABLE_STORY_PARTS).toBeGreaterThan(1);
  });
});

describe('TreeDocxSession — package-aware HF mutation', () => {
  test('session applyTreeOps targets HF by EditorScope-shaped rId and invalidates resolution cache', () => {
    const opened = openTreeSession(sharedHeaderDoc());
    if (!opened.ok) throw new Error(opened.reason);
    const session = opened.session;

    const before = session.headerFooterPartsBySection();
    expect(before).toHaveLength(2);
    const sharedBefore = before[0]!.headers.get('default')!;
    const headerId = paragraphIds(sharedBefore)[0]!;

    const changes: TreeModelChange[] = [];
    session.subscribe((change) => changes.push(change));

    const bodyRev = session.revision();
    const result = session.applyTreeOps(
      [{ op: 'insertText', paragraphId: headerId, offset: 0, text: 'Z-' }],
      null,
      null,
      { kind: 'headerFooter', rId: 'rId7' }
    );
    expect(result.committed).toBe(true);
    expect(result.rejected).toBe(false);
    expect(session.revision()).toBe(bodyRev); // body store untouched
    expect(session.revisionFor({ kind: 'headerFooter', rId: 'rId7' })).toBe(1);
    expect(session.packageRevision()).toBe(1);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.impact).toBe('global');

    const after = session.headerFooterPartsBySection();
    expect(after[0]!.headers.get('default')).toBe(after[1]!.headers.get('default'));
    expect(session.storyText({ kind: 'headerFooter', rId: 'rId7' })).toBe('Z-SHARED');

    const reopened = openTreeSession(session.save());
    if (!reopened.ok) throw new Error(reopened.reason);
    expect(reopened.session.storyText({ kind: 'headerFooter', rId: 'rId7' })).toBe('Z-SHARED');
  });

  test('invalid HF rId is rejected without mutating the body', () => {
    const opened = openTreeSession(bodyAndHeaderDoc());
    if (!opened.ok) throw new Error(opened.reason);
    const session = opened.session;
    const bodyBefore = session.bodyText();
    const result = session.applyTreeOps(
      [{ op: 'insertText', paragraphId: 'x', offset: 0, text: 'nope' }],
      null,
      null,
      { kind: 'headerFooter', rId: 'missing' }
    );
    expect(result.rejected).toBe(true);
    expect(result.reason).toBe('dangling-relationship');
    expect(session.bodyText()).toBe(bodyBefore);
    expect(session.packageRevision()).toBe(0);
  });
});
