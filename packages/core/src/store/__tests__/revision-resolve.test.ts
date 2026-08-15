// Accept and reject over the canonical tree.
//
// The rules that matter are the ones a plausible-looking implementation gets wrong:
// containment order on nested revisions, a move resolving as one decision rather than two, and
// refusing the revision kinds whose structural semantics are not implemented instead of
// removing their markup and reporting success.

import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlPart,
  type TreeDocOp,
} from '../index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function load(body: string): OoxmlPart {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function loadNotes(notes: string): OoxmlPart {
  const result = readOoxmlPart(`<w:footnotes xmlns:w="${W}">${notes}</w:footnotes>`, {
    name: '/word/footnotes.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}${result.detail ? `: ${result.detail}` : ''}`);
  return result.part;
}

function refuse(part: OoxmlPart, op: TreeDocOp): string {
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected a refusal');
  return result.reason;
}

/** Body text as the serializer writes it, so the assertions read like the file. */
function xml(part: OoxmlPart): string {
  return serializeOoxmlPart(part);
}

const run = (text: string) => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const delRun = (text: string) => `<w:r><w:delText xml:space="preserve">${text}</w:delText></w:r>`;
const QA = { id: '1', author: 'QA', date: '2026-03-26T11:00:00Z' };
const DEV = { id: '2', author: 'Dev', date: '2026-03-26T12:00:00Z' };
const wrap = (name: string, who: typeof QA, inner: string) =>
  `<w:${name} w:id="${who.id}" w:author="${who.author}" w:date="${who.date}">${inner}</w:${name}>`;

const accept = (revision: typeof QA): TreeDocOp => ({ op: 'acceptRevision', revision });
const reject = (revision: typeof QA): TreeDocOp => ({ op: 'rejectRevision', revision });

describe('insertions', () => {
  const doc = () => load(`<w:p>${run('keep ')}${wrap('ins', QA, run('new'))}</w:p>`);

  test('accepting unwraps it and keeps the content', () => {
    const out = xml(apply(doc(), accept(QA)));
    expect(out).not.toContain('<w:ins');
    expect(out).toContain('keep ');
    expect(out).toContain('new');
  });

  test('rejecting removes the wrapper and its content', () => {
    const out = xml(apply(doc(), reject(QA)));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('new');
    expect(out).toContain('keep ');
  });
});

describe('deletions', () => {
  const doc = () => load(`<w:p>${run('keep ')}${wrap('del', DEV, delRun('old'))}</w:p>`);

  test('accepting removes the wrapper and its content', () => {
    const out = xml(apply(doc(), accept(DEV)));
    expect(out).not.toContain('<w:del');
    expect(out).not.toContain('old');
  });

  test('rejecting restores the text and turns w:delText back into w:t', () => {
    const out = xml(apply(doc(), reject(DEV)));
    expect(out).not.toContain('<w:del');
    expect(out).not.toContain('delText');
    // The serializer drops `xml:space="preserve"` where it is not needed, so the assertion is
    // that the text is back in a `w:t`, not that the attribute survived a normalization.
    expect(out).toContain('>old</w:t>');
  });
});

describe('nested revisions resolve by containment', () => {
  // An insertion by QA inside a deletion by Dev.
  const doc = () => load(`<w:p>${wrap('del', DEV, wrap('ins', QA, run('x')))}</w:p>`);

  test('accepting the outer deletion takes the inner insertion with it', () => {
    const out = xml(apply(doc(), accept(DEV)));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('>x<');
  });

  test('rejecting the outer deletion leaves the inner insertion pending', () => {
    const out = xml(apply(doc(), reject(DEV)));
    expect(out).not.toContain('<w:del');
    expect(out).toContain('<w:ins');
    expect(out).toContain('>x<');
  });

  test('the result does not depend on which wrapper is addressed first', () => {
    // Resolve the inner one first, then the outer: same tree as the outer alone.
    const innerFirst = xml(apply(apply(doc(), accept(QA)), accept(DEV)));
    const outerOnly = xml(apply(doc(), accept(DEV)));
    expect(innerFirst).toBe(outerOnly);
  });
});

describe('a move is one decision', () => {
  const MOVE_NAME = 'move1';
  const doc = () =>
    load(
      '<w:p>' +
        `<w:moveFromRangeStart w:id="10" w:name="${MOVE_NAME}" w:author="QA" w:date="${QA.date}"/>` +
        wrap('moveFrom', QA, delRun('here')) +
        '<w:moveFromRangeEnd w:id="10"/>' +
        '</w:p><w:p>' +
        `<w:moveToRangeStart w:id="11" w:name="${MOVE_NAME}" w:author="QA" w:date="${QA.date}"/>` +
        wrap('moveTo', DEV, run('here')) +
        '<w:moveToRangeEnd w:id="11"/>' +
        '</w:p>'
    );

  test('accepting one half resolves both, so the content is not duplicated', () => {
    // The two halves carry DIFFERENT ids in real documents, which is why they are paired by
    // `@w:name` on the range markers rather than by id.
    const out = xml(apply(doc(), accept(QA)));
    expect(out).not.toContain('<w:moveFrom w');
    expect(out).not.toContain('<w:moveTo w');
    // Exactly one copy survives, at the destination.
    expect(out.match(/here/g) ?? []).toHaveLength(1);
    expect(out).not.toContain('delText');
  });

  test('rejecting one half resolves both, and the content returns to its origin', () => {
    const out = xml(apply(doc(), reject(DEV)));
    expect(out).not.toContain('<w:moveFrom w');
    expect(out).not.toContain('<w:moveTo w');
    expect(out.match(/here/g) ?? []).toHaveLength(1);
    expect(out).not.toContain('delText');
  });

  test('the range markers go with the move they described', () => {
    // Left behind, they would be an empty named bookmark pair that pairs with nothing on the
    // next read. Word removes them when the move resolves.
    const out = xml(apply(doc(), accept(QA)));
    expect(out).not.toContain('moveFromRangeStart');
    expect(out).not.toContain('moveToRangeEnd');
  });

  test('an orphaned half degrades to insertion semantics rather than refusing the file', () => {
    const orphan = load(
      '<w:p>' +
        `<w:moveToRangeStart w:id="11" w:name="lonely" w:author="QA" w:date="${QA.date}"/>` +
        wrap('moveTo', DEV, run('arrived')) +
        '<w:moveToRangeEnd w:id="11"/></w:p>'
    );
    const out = xml(apply(orphan, accept(DEV)));
    expect(out).not.toContain('<w:moveTo w');
    expect(out).toContain('arrived');
  });
});

describe('property changes', () => {
  test('accepting a w:rPrChange keeps the current properties', () => {
    const part = load(
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="QA" w:date="${QA.date}">` +
        '<w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>text</w:t></w:r></w:p>'
    );
    const out = xml(apply(part, accept(QA)));
    expect(out).not.toContain('rPrChange');
    expect(out).toContain('<w:b/>');
    expect(out).not.toContain('<w:i/>');
  });

  test('rejecting a w:rPrChange restores the recorded properties', () => {
    const part = load(
      `<w:p><w:r><w:rPr><w:b/><w:rPrChange w:id="1" w:author="QA" w:date="${QA.date}">` +
        '<w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>text</w:t></w:r></w:p>'
    );
    const out = xml(apply(part, reject(QA)));
    expect(out).not.toContain('rPrChange');
    expect(out).toContain('<w:i/>');
    expect(out).not.toContain('<w:b/>');
  });

  test('rejecting a w:pPrChange restores the recorded paragraph properties', () => {
    const part = load(
      `<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="1" w:author="QA" w:date="${QA.date}">` +
        '<w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr>' +
        `${run('text')}</w:p>`
    );
    const out = xml(apply(part, reject(QA)));
    expect(out).not.toContain('pPrChange');
    expect(out).toContain('<w:jc w:val="left"/>');
    expect(out).not.toContain('center');
  });
});

describe('structural revision resolution', () => {
  test('accepting a complete tracked row deletion removes the row', () => {
    const part = load(
      `<w:tbl><w:tr><w:trPr><w:del w:id="1" w:author="QA" w:date="${QA.date}"/></w:trPr>` +
        `<w:tc><w:tcPr><w:cellDel w:id="1" w:author="QA" w:date="${QA.date}"/></w:tcPr>` +
        `<w:p>${run('cell')}</w:p></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p>${run('keep')}</w:p></w:tc></w:tr></w:tbl>`
    );
    const out = xml(apply(part, accept(QA)));
    expect(out).not.toContain('cell');
    expect(out).toContain('keep');
    expect(out).not.toContain('cellDel');
  });

  test('a refused kind leaves the tree byte-identical', () => {
    const part = load(
      `<w:tbl><w:tr><w:tc><w:tcPr><w:cellIns w:id="1" w:author="QA" w:date="${QA.date}"/></w:tcPr>` +
        `<w:p>${run('cell')}</w:p></w:tc></w:tr></w:tbl>`
    );
    const before = xml(part);
    refuse(part, accept(QA));
    expect(xml(part)).toBe(before);
  });

  test('one refused site refuses the whole revision, not just that site', () => {
    // A tracked row insertion is `w:trPr/w:ins` on the row plus `w:cellIns` on every cell,
    // all sharing one triple. Resolving the inline half alone would leave the row half-tracked.
    const part = load(
      `<w:tbl><w:tr><w:trPr><w:ins w:id="1" w:author="QA" w:date="${QA.date}"/></w:trPr>` +
        `<w:tc><w:p>${wrap('ins', QA, run('cell'))}</w:p></w:tc></w:tr></w:tbl>`
    );
    expect(refuse(part, accept(QA))).toBe('unsupported-revision');
    expect(xml(part)).toContain('<w:ins');
  });
});

describe('addressing', () => {
  test('a revision that is not present is refused', () => {
    const part = load(`<w:p>${run('plain')}</w:p>`);
    expect(refuse(part, accept(QA))).toBe('unknown-revision');
  });

  test('two authors sharing one id are separately addressable', () => {
    const other = { id: '1', author: 'Other', date: QA.date };
    const part = load(
      `<w:p>${wrap('ins', QA, run('mine'))}${wrap('ins', other, run('theirs'))}</w:p>`
    );
    const out = xml(apply(part, reject(QA)));
    expect(out).not.toContain('mine');
    expect(out).toContain('theirs');
  });

  test('a differing date is a different revision', () => {
    const later = { id: '1', author: 'QA', date: '2026-04-01T09:00:00Z' };
    const part = load(
      `<w:p>${wrap('ins', QA, run('first'))}${wrap('ins', later, run('second'))}</w:p>`
    );
    const out = xml(apply(part, reject(later)));
    expect(out).toContain('first');
    expect(out).not.toContain('second');
  });

  test('every site sharing the triple resolves in one transaction', () => {
    const part = load(
      `<w:p>${wrap('ins', QA, run('one'))}${run(' and ')}${wrap('ins', QA, run('two'))}</w:p>`
    );
    const out = xml(apply(part, reject(QA)));
    expect(out).not.toContain('one');
    expect(out).not.toContain('two');
    expect(out).toContain(' and ');
  });
});

describe('accept-all and reject-all', () => {
  const doc = () =>
    load(
      `<w:p>${run('keep ')}${wrap('ins', QA, run('new '))}${wrap('del', DEV, delRun('old'))}</w:p>`
    );

  test('accept-all produces the proposed result', () => {
    const out = xml(apply(doc(), { op: 'acceptAllRevisions' }));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('<w:del');
    expect(out).toContain('new ');
    expect(out).not.toContain('old');
  });

  test('reject-all produces the original', () => {
    const out = xml(apply(doc(), { op: 'rejectAllRevisions' }));
    expect(out).not.toContain('<w:ins');
    expect(out).not.toContain('<w:del');
    expect(out).not.toContain('new ');
    expect(out).toContain('old');
  });

  test('a document with no revisions refuses rather than reporting a no-op change', () => {
    expect(refuse(load(`<w:p>${run('plain')}</w:p>`), { op: 'acceptAllRevisions' })).toBe(
      'unknown-revision'
    );
  });

  test('accept-all refuses when any revision in the document is a refused kind', () => {
    const part = load(
      `<w:p>${wrap('ins', QA, run('inline'))}</w:p>` +
        `<w:tbl><w:tr><w:trPr><w:del w:id="9" w:author="Dev" w:date="${DEV.date}"/></w:trPr>` +
        '<w:tc><w:p/></w:tc></w:tr></w:tbl>'
    );
    expect(refuse(part, { op: 'acceptAllRevisions' })).toBe('unsupported-revision');
    expect(xml(part)).toContain('<w:ins');
  });

  test('a canonical note-root scope resolves only that note despite colliding identities', () => {
    const part = loadNotes(
      `<w:footnote w:id="1"><w:p>${wrap('ins', QA, run('target'))}</w:p>` +
        `<w:tbl><w:tr><w:trPr><w:ins w:id="8" w:author="Row"/></w:trPr>` +
        `<w:tc><w:tcPr><w:cellIns w:id="8" w:author="Row"/></w:tcPr>` +
        `<w:p>${run('tracked row')}</w:p></w:tc></w:tr></w:tbl></w:footnote>` +
        `<w:footnote w:id="2"><w:p>${wrap('ins', QA, run('sibling'))}</w:p>` +
        `<w:tbl><w:tr><w:trPr><w:del w:id="9" w:author="Dev"/></w:trPr>` +
        `<w:tc><w:p>${run('unsupported')}</w:p></w:tc></w:tr></w:tbl></w:footnote>`
    );
    const target = part.root.children.find(
      (node) => node.kind !== 'textValue' && node.localName === 'footnote'
    );
    if (!target || target.kind === 'textValue') throw new Error('missing target note');

    const out = xml(apply(part, { op: 'acceptAllRevisions', scopeRootId: target.id }));
    expect(out).toContain('target');
    expect(out.match(/<w:ins\b/g) ?? []).toHaveLength(1);
    expect(out).not.toContain('cellIns');
    expect(out).toContain('tracked row');
    expect(out).toContain('sibling');
    expect(out).toContain('w:id="9"');
  });

  test('an unsupported revision inside a scoped note refuses atomically', () => {
    const part = loadNotes(
      `<w:footnote w:id="1"><w:p>${wrap('ins', QA, run('target'))}</w:p>` +
        `<w:tbl><w:tr><w:trPr><w:del w:id="9" w:author="Dev"/></w:trPr>` +
        `<w:tc><w:p>${run('incomplete')}</w:p></w:tc></w:tr></w:tbl></w:footnote>` +
        `<w:footnote w:id="2"><w:p>${wrap('ins', QA, run('sibling'))}</w:p></w:footnote>`
    );
    const target = part.root.children.find(
      (node) => node.kind !== 'textValue' && node.localName === 'footnote'
    );
    if (!target || target.kind === 'textValue') throw new Error('missing target note');
    const before = xml(part);

    expect(refuse(part, { op: 'acceptAllRevisions', scopeRootId: target.id })).toBe(
      'unsupported-revision'
    );
    expect(xml(part)).toBe(before);
  });

  test('a scoped all-decision refuses roots that are missing or are not notes', () => {
    const part = load(`<w:p>${wrap('ins', QA, run('target'))}</w:p>`);
    const paragraph = part.root.children[0]?.kind === 'textValue' ? null : part.root.children[0];
    if (!paragraph) throw new Error('missing body');
    const body = paragraph.children[0];
    if (!body || body.kind === 'textValue') throw new Error('missing paragraph');

    expect(refuse(part, { op: 'acceptAllRevisions', scopeRootId: '' })).toBe(
      'invalid-property-value'
    );
    expect(refuse(part, { op: 'acceptAllRevisions', scopeRootId: body.id })).toBe(
      'invalid-property-value'
    );
  });
});
