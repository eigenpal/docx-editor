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
  type TreePackageStoreOptions,
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

function openPackage(bytes: Uint8Array, options?: TreePackageStoreOptions) {
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
  test('ordinary body delete does not run a package-wide note cascade', () => {
    let cascadeCalls = 0;
    const store = openPackage(build({}), {
      cascadeDeletedNoteReferences: (_before, after) => {
        cascadeCalls += 1;
        return after;
      },
    });
    const bodyScope: StoryScope = { kind: 'body' };
    const bodyId = paragraphIds(store.partFor(bodyScope)!)[0]!;

    const result = store.transact(bodyScope, (ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId: bodyId, start: 3, end: 4 });
    });

    expect(result.ok).toBe(true);
    expect(cascadeCalls).toBe(0);
    expect(paragraphTextOf(store.partFor(bodyScope)!, bodyId)).toBe('bod');
  });

  test('switching composition scope closes the previous story history unit', () => {
    const store = openPackage(bodyAndHeaderDoc());
    const bodyScope: StoryScope = { kind: 'body' };
    const headerScope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    const bodyId = paragraphIds(store.partFor(bodyScope)!)[0]!;
    const headerId = paragraphIds(store.partFor(headerScope)!)[0]!;

    expect(store.beginComposition(bodyScope)).toBe(true);
    expect(
      store.transact(bodyScope, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: bodyId, offset: 4, text: '!' });
      }).ok
    ).toBe(true);
    expect(store.beginComposition(headerScope)).toBe(true);
    expect(
      store.transact(headerScope, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 6, text: 'X' });
      }).ok
    ).toBe(true);
    store.endComposition();

    expect(store.canUndo).toBe(true);
    store.undo();
    expect(paragraphTextOf(store.partFor(headerScope)!, headerId)).toBe('HEADER');
    store.undo();
    expect(paragraphTextOf(store.partFor(bodyScope)!, bodyId)).toBe('body');
  });

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

describe('TreePackageStore — parked story history across delete/restore', () => {
  test('edit → delete → undo → undo restores story edit; redo is symmetric', () => {
    const store = openPackage(bodyAndHeaderDoc());
    const headerScope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    const headerId = paragraphIds(store.partFor(headerScope)!)[0]!;

    store.transact(headerScope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 0, text: 'EDIT-' });
    });
    expect(paragraphTextOf(store.partFor(headerScope)!, headerId)).toBe('EDIT-HEADER');
    expect(store.openedStoryCount()).toBe(2); // body + opened header

    const deleted = store.applyLifecycleOp({
      op: 'deleteHeaderFooter',
      sectionIndex: 0,
      kind: 'header',
      variant: 'default',
    });
    expect(deleted.ok).toBe(true);
    expect(store.currentPackage().parts.has('/word/header1.xml')).toBe(false);
    // Store stays parked for history identity.
    expect(store.openedStoryCount()).toBe(2);

    // Undo delete — part returns; parked store reconnects with edited content.
    expect(store.undo()).not.toBeNull();
    expect(store.currentPackage().parts.has('/word/header1.xml')).toBe(true);
    expect(paragraphTextOf(store.partFor(headerScope)!, headerId)).toBe('EDIT-HEADER');

    // Undo story edit — no stale revision / missing store.
    expect(store.undo()).not.toBeNull();
    expect(paragraphTextOf(store.partFor(headerScope)!, headerId)).toBe('HEADER');

    // Redo edit, then redo delete.
    expect(store.redo()).not.toBeNull();
    expect(paragraphTextOf(store.partFor(headerScope)!, headerId)).toBe('EDIT-HEADER');
    expect(store.redo()).not.toBeNull();
    expect(store.currentPackage().parts.has('/word/header1.xml')).toBe(false);
  });

  test('parked stores retain the cap while history can restore them; evict when unreachable', () => {
    // Cap is body + 1. Opening the header parks it on delete; the footer is a distinct
    // part that still cannot open while the parked identity is history-reachable.
    const withHistory = openPackage(bodyAndHeaderDoc(), {
      maxEditableStoryParts: 2,
      historyLimit: 50,
    });
    const headerScope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    const headerId = paragraphIds(withHistory.partFor(headerScope)!)[0]!;
    withHistory.transact(headerScope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 0, text: 'A' });
    });
    expect(
      withHistory.applyLifecycleOp({
        op: 'deleteHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    expect(withHistory.openedStoryCount()).toBe(2); // parked, retained by undo

    const footerWhileParked = withHistory.resolveStory({ kind: 'headerFooter', rId: 'rId8' });
    expect(footerWhileParked.ok).toBe(false);
    if (!footerWhileParked.ok) expect(footerWhileParked.reason).toBe('too-many-story-stores');

    // Tight history: drop the delete pointer so the parked store becomes unreachable.
    const evicting = openPackage(bodyAndHeaderDoc(), {
      maxEditableStoryParts: 2,
      historyLimit: 1,
    });
    const evictScope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    const evictId = paragraphIds(evicting.partFor(evictScope)!)[0]!;
    evicting.transact(evictScope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: evictId, offset: 0, text: 'X' });
    });
    expect(
      evicting.applyLifecycleOp({
        op: 'deleteHeaderFooter',
        sectionIndex: 0,
        kind: 'header',
        variant: 'default',
      }).ok
    ).toBe(true);
    expect(evicting.openedStoryCount()).toBe(2);

    const bodyId = paragraphIds(evicting.bodyStore().part)[0]!;
    expect(
      evicting.transact({ kind: 'body' }, (ctx) => {
        ctx.apply({ op: 'insertText', paragraphId: bodyId, offset: 0, text: '!' });
      }).ok
    ).toBe(true);
    // historyLimit 1: body story pointer replaces delete → parked evicted.
    expect(evicting.openedStoryCount()).toBe(1);

    const footerAfterEvict = evicting.resolveStory({ kind: 'headerFooter', rId: 'rId8' });
    expect(footerAfterEvict.ok).toBe(true);
    expect(evicting.openedStoryCount()).toBe(2);
  });
});

describe('TreePackageStore — currentPackage identity memo', () => {
  test('repeated calls with unchanged authority return the same frozen instance', () => {
    const store = openPackage(build({}));
    const first = store.currentPackage();
    expect(store.currentPackage()).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
  });

  test('a body transact yields a fresh, content-correct snapshot', () => {
    const store = openPackage(build({}));
    const before = store.currentPackage();
    const bodyId = paragraphIds(store.bodyStore().part)[0]!;
    store.transact({ kind: 'body' }, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: bodyId, offset: 0, text: 'X' });
    });
    const after = store.currentPackage();
    expect(after).not.toBe(before);
    const main = after.parts.get(after.mainDocumentPart)!;
    expect(paragraphTextOf(main, paragraphIds(main)[0]!)).toContain('X');
    expect(store.currentPackage()).toBe(after);
  });

  test('replacePackageShell invalidates without a revision bump', () => {
    const store = openPackage(build({}));
    const before = store.currentPackage();
    const revBefore = store.packageRevision;
    store.replacePackageShell(before);
    expect(store.packageRevision).toBe(revBefore);
    const after = store.currentPackage();
    expect(after).not.toBe(before);
    expect(store.currentPackage()).toBe(after);
  });

  test('opening a story store invalidates, and undo/redo track the snapshot', () => {
    const store = openPackage(bodyAndHeaderDoc());
    const closed = store.currentPackage();
    const scope: StoryScope = { kind: 'headerFooter', rId: 'rId7' };
    expect(store.resolveStory(scope).ok).toBe(true);
    const opened = store.currentPackage();
    expect(opened).not.toBe(closed);

    const headerId = paragraphIds(store.partFor(scope)!)[0]!;
    store.transact(scope, (ctx) => {
      ctx.apply({ op: 'insertText', paragraphId: headerId, offset: 0, text: 'Z' });
    });
    const edited = store.currentPackage();
    expect(edited).not.toBe(opened);
    expect(paragraphTextOf(edited.parts.get('/word/header1.xml')!, headerId)).toContain('Z');

    store.undo();
    const undone = store.currentPackage();
    expect(undone).not.toBe(edited);
    expect(paragraphTextOf(undone.parts.get('/word/header1.xml')!, headerId)).not.toContain('Z');

    store.redo();
    const redone = store.currentPackage();
    expect(paragraphTextOf(redone.parts.get('/word/header1.xml')!, headerId)).toContain('Z');
  });

  test('installPackageSnapshot invalidates', () => {
    const store = openPackage(build({}));
    const before = store.currentPackage();
    store.installPackageSnapshot(
      loadPackage(build({ body: '<w:p><w:r><w:t>other</w:t></w:r></w:p>' }))
    );
    const after = store.currentPackage();
    expect(after).not.toBe(before);
    expect(store.currentPackage()).toBe(after);
  });
});
