// A lock is only a lock if EVERY write meets it.
//
// The refusal used to be gated on an allowlist of op names, which means the guarantee was "the
// ops somebody remembered", not "the document is protected". Accepting a tracked change rewrites
// runs; retargeting a hyperlink rewrites a relationship the locked text points at; removing one
// splices its children into the paragraph. None of those are in the text-editing vocabulary and
// all of them change what a locked control encloses.
//
// So the classification is exhaustive over `TreeDocOp` and FAILS CLOSED: an op nobody has
// classified is treated as reaching the whole part, which is refused wherever anything is locked
// or protected. A future op is therefore over-refused until somebody classifies it, rather than
// silently unguarded.

import { describe, expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  contentControlsIn,
  readOoxmlPart,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import {
  TREE_DOC_OP_KINDS,
  type TreeDocOp,
  type TreeDocOpKind,
  type TreeOpRejection,
} from '../store/tree-op-types.ts';
import {
  TREE_OP_REACH_CLASSIFIED,
  formsProtectionRefusal,
  treeOpReach,
} from '../store/tree-op-content-controls.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

function paragraphs(part: OoxmlPart): readonly OoxmlNode[] {
  const body = bodyStoryRoot(part);
  return body ? storyParagraphs(body) : [];
}

const QA = { id: '1', author: 'QA', date: '2026-03-26T11:00:00Z' };

function protectedSettings(): OoxmlPart {
  const result = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`,
    { name: '/word/settings.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** A locked control holding a tracked insertion, so accept/reject has something to rewrite. */
function lockedWithRevision(lock = 'sdtContentLocked'): OoxmlPart {
  return parseDoc(
    `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="${lock}"/></w:sdtPr><w:sdtContent>` +
      `<w:p><w:ins w:id="1" w:author="QA" w:date="2026-03-26T11:00:00Z">` +
      `<w:r><w:t>added</w:t></w:r></w:ins></w:p>` +
      `</w:sdtContent></w:sdt>`
  );
}

/** A locked control holding a hyperlink, so retarget/remove has something to rewrite. */
function lockedWithLink(lock = 'sdtContentLocked'): OoxmlPart {
  return parseDoc(
    `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="${lock}"/></w:sdtPr><w:sdtContent>` +
      `<w:p><w:hyperlink r:id="rId9" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>` +
      `</w:sdtContent></w:sdt>`
  );
}

function linkIdOf(part: OoxmlPart): string {
  const find = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'hyperlink') return node;
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const link = find(part.root);
  if (!link) throw new Error('no link');
  return link.id;
}

describe('every op kind is classified, and an unclassified one reaches everything', () => {
  test('the classification covers the whole op vocabulary', () => {
    const unclassified: TreeDocOpKind[] = TREE_DOC_OP_KINDS.filter(
      (kind) => !TREE_OP_REACH_CLASSIFIED.has(kind)
    );
    expect(unclassified).toEqual([]);
  });

  test('an op name nothing declares reaches the whole part rather than nothing', () => {
    expect(treeOpReach({ op: 'someOpFromTheFuture' } as unknown as TreeDocOp)).toEqual({
      kind: 'part',
    });
  });
});

describe('accepting and rejecting a tracked change meets the lock', () => {
  test('acceptRevision inside a locked control is refused', () => {
    const part = lockedWithRevision();
    expect(refusal(part, { op: 'acceptRevision', revision: QA })).toBe('locked');
  });

  test('rejectRevision inside a locked control is refused', () => {
    const part = lockedWithRevision();
    expect(refusal(part, { op: 'rejectRevision', revision: QA })).toBe('locked');
  });

  test('acceptAllRevisions is refused while any locked content carries one', () => {
    const part = lockedWithRevision();
    expect(refusal(part, { op: 'acceptAllRevisions' })).toBe('locked');
  });

  test('rejectAllRevisions is refused the same way', () => {
    const part = lockedWithRevision();
    expect(refusal(part, { op: 'rejectAllRevisions' })).toBe('locked');
  });

  test('a document with no locked content still accepts all of them', () => {
    const part = parseDoc(
      `<w:p><w:ins w:id="1" w:author="QA" w:date="2026-03-26T11:00:00Z">` +
        `<w:r><w:t>added</w:t></w:r></w:ins></w:p>`
    );
    expect(refusal(part, { op: 'acceptAllRevisions' })).toBeNull();
  });

  // `sdtLocked` guards the control, not its content, so a decision about the content is allowed.
  test('sdtLocked does not refuse a decision about the content it holds', () => {
    const part = lockedWithRevision('sdtLocked');
    expect(refusal(part, { op: 'acceptRevision', revision: QA })).toBeNull();
  });
});

describe('hyperlink writes meet the lock of the control that owns the link', () => {
  test('retargeting a link inside a locked control is refused', () => {
    const part = lockedWithLink();
    expect(
      refusal(part, { op: 'setHyperlinkTarget', linkId: linkIdOf(part), anchor: 'elsewhere' })
    ).toBe('locked');
  });

  test('removing a link inside a locked control is refused', () => {
    const part = lockedWithLink();
    expect(refusal(part, { op: 'removeHyperlink', linkId: linkIdOf(part) })).toBe('locked');
  });

  test('a link outside every control is still editable', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>locked</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `<w:p><w:hyperlink w:anchor="top"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>`
    );
    expect(
      refusal(part, { op: 'setHyperlinkTarget', linkId: linkIdOf(part), anchor: 'elsewhere' })
    ).toBeNull();
  });

  test('a link id nothing declares is refused as a bad reference, not as a lock', () => {
    const part = lockedWithLink();
    expect(refusal(part, { op: 'removeHyperlink', linkId: 'nope' })).not.toBe('locked');
  });
});

describe('forms protection reaches the same ops', () => {
  const settings = protectedSettings;

  test('accepting every revision is refused while forms protection holds', () => {
    const part = parseDoc(
      `<w:p><w:ins w:id="1" w:author="QA" w:date="2026-03-26T11:00:00Z">` +
        `<w:r><w:t>added</w:t></w:r></w:ins></w:p>`
    );
    expect(formsProtectionRefusal(part, settings(), { op: 'acceptAllRevisions' })).toBe('locked');
  });

  test('retargeting a link outside every control is refused while forms protection holds', () => {
    const part = parseDoc(
      `<w:p><w:hyperlink w:anchor="top"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>`
    );
    expect(
      formsProtectionRefusal(part, settings(), {
        op: 'setHyperlinkTarget',
        linkId: linkIdOf(part),
        anchor: 'elsewhere',
      })
    ).toBe('locked');
  });

  test('a link inside an unlocked control is still retargetable under forms protection', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:hyperlink w:anchor="top"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>` +
        `</w:sdtContent></w:sdt>`
    );
    expect(
      formsProtectionRefusal(part, settings(), {
        op: 'setHyperlinkTarget',
        linkId: linkIdOf(part),
        anchor: 'elsewhere',
      })
    ).toBeNull();
  });

  test('a section-wide property write is refused while forms protection holds', () => {
    const part = parseDoc(`<w:p><w:r><w:t>text</w:t></w:r></w:p>`);
    expect(
      formsProtectionRefusal(part, settings(), {
        op: 'setSectionProperties',
        marginTopTwips: 720,
      })
    ).toBe('locked');
  });
});

// A LOCK PROTECTS CONTENT; IT IS NOT A LICENCE OVER THE DOCUMENT. `w:sdtPr/w:lock` says what may
// happen to the control and to the characters it holds. Page setup, section furniture and note
// numbering change none of those, so a control that forbids content edits must not be able to
// freeze the document's own properties — Word does not work that way, and a template with one
// locked field would otherwise have unchangeable margins.
//
// Forms protection is the opposite question and keeps its own answer: `w:edit="forms"` means the
// document is read-only except for filling in fields, and page setup is not filling in a field.
describe('a document-property write is not content, and a lock does not refuse it', () => {
  const withLockedControl = (lock: string) =>
    parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="${lock}"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>locked</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );

  test('page setup is allowed beside a contentLocked control', () => {
    expect(
      refusal(withLockedControl('sdtContentLocked'), {
        op: 'setSectionProperties',
        marginTopTwips: 720,
      })
    ).toBeNull();
  });

  test('section furniture options are allowed too', () => {
    expect(
      refusal(withLockedControl('sdtContentLocked'), {
        op: 'setSectionFurnitureOptions',
        titlePage: true,
      })
    ).not.toBe('locked');
  });

  test('note numbering is a document property, not the content of a field', () => {
    expect(
      refusal(withLockedControl('contentLocked'), {
        op: 'setNoteProperties',
        scope: 'document',
        footnote: { numFmt: 'lowerRoman' },
      })
    ).not.toBe('locked');
  });

  test('and none of it is allowed while forms protection holds', () => {
    const settings = protectedSettings();
    const part = parseDoc(`<w:p><w:r><w:t>text</w:t></w:r></w:p>`);
    expect(
      formsProtectionRefusal(part, settings, { op: 'setSectionProperties', marginTopTwips: 720 })
    ).toBe('locked');
    expect(
      formsProtectionRefusal(part, settings, {
        op: 'setNoteProperties',
        scope: 'document',
        footnote: { numFmt: 'lowerRoman' },
      })
    ).toBe('locked');
  });
});

describe('an op that could rewrite content anywhere still fails closed', () => {
  // Deleting or converting a note rewrites the RUN that referenced it, wherever that run is —
  // possibly inside a locked control. The op names a note id, which is not a body address, so
  // nothing narrows it and the conservative answer is the only available one.
  test('deleting a note is refused while a control forbids content edits', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>locked</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    expect(refusal(part, { op: 'deleteNote', noteKind: 'footnote', noteId: 2 })).toBe('locked');
    expect(refusal(part, { op: 'convertAllNotes', fromKind: 'footnote' })).toBe('locked');
  });

  test('and allowed in a document whose controls are unlocked', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>free</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    expect(refusal(part, { op: 'deleteNote', noteKind: 'footnote', noteId: 2 })).not.toBe('locked');
  });
});

// TABLE AND TOC OPS ARE CONTENT OPS. They arrived with their own validators, which ask about
// grids and rows; none of them asks whether the cell being rewritten belongs to a locked field.
// The classification is where that question is answered, and the shape of the answer differs by
// what the op does to the table: topology REARRANGES what the table holds, a column delete also
// DESTROYS some of it, and geometry or shading changes neither.
describe('table and TOC ops meet the controls their tables hold', () => {
  function nodesOfKind(part: OoxmlPart, kind: string): OoxmlNode[] {
    const found: OoxmlNode[] = [];
    const walk = (node: OoxmlNode): void => {
      if (node.kind === 'textValue') return;
      if (node.kind === kind) found.push(node);
      for (const child of node.children) walk(child);
    };
    walk(part.root);
    return found;
  }

  /** A two-by-two table whose second cell holds one control, described by `properties`. */
  function tableHolding(properties: string): OoxmlPart {
    return parseDoc(
      `<w:tbl><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:p><w:r><w:t>free</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:sdt><w:sdtPr><w:tag w:val="t"/>${properties}</w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>held</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc></w:tr>` +
        `<w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc>` +
        `<w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
  }

  const contentLocked = '<w:lock w:val="sdtContentLocked"/>';
  const wrapperLocked = '<w:lock w:val="sdtLocked"/>';
  const bound = '<w:dataBinding w:xpath="/a" w:storeItemID="{GUID}"/>';

  const tableId = (part: OoxmlPart): string => nodesOfKind(part, 'table')[0]!.id;

  test('adding a row is refused while the table holds a control that forbids content edits', () => {
    const part = tableHolding(contentLocked);
    const rows = nodesOfKind(part, 'tableRow');
    expect(
      refusal(part, {
        op: 'insertTableRow',
        tableId: tableId(part),
        rowId: rows[0]!.id,
        where: 'below',
      })
    ).toBe('locked');
  });

  // `sdtLocked` guards the wrapper and expressly allows editing what it holds, so rearranging
  // the table around it is not the thing it forbids.
  test('a wrapper-only lock does not refuse a row insertion', () => {
    const part = tableHolding(wrapperLocked);
    const rows = nodesOfKind(part, 'tableRow');
    expect(
      refusal(part, {
        op: 'insertTableRow',
        tableId: tableId(part),
        rowId: rows[0]!.id,
        where: 'below',
      })
    ).not.toBe('locked');
  });

  // Deleting a column takes one cell out of every row, and which cells those are is not in the
  // op. The wrapper lock is the one that speaks to a control being deleted.
  test('deleting a column is refused by a wrapper lock the op never named', () => {
    const part = tableHolding(wrapperLocked);
    const columns = nodesOfKind(part, 'tableGridColumn');
    expect(
      refusal(part, {
        op: 'deleteTableColumn',
        tableId: tableId(part),
        gridColumnId: columns[0]?.id ?? 'grid',
      })
    ).toBe('locked');
  });

  // The same op still has to answer the binding question, which is asked of controls the op
  // does NOT remove. One target cannot be both, so the classification names two.
  test('deleting a column is refused as bound while the table mirrors a custom XML part', () => {
    const part = tableHolding(bound);
    const columns = nodesOfKind(part, 'tableGridColumn');
    expect(
      refusal(part, {
        op: 'deleteTableColumn',
        tableId: tableId(part),
        gridColumnId: columns[0]?.id ?? 'grid',
      })
    ).toBe('bound');
  });

  // Shading is a property OF THE CELL, the same way `w:pPr` is a property of a paragraph: the
  // characters a control holds inside it are untouched, so its lock has nothing to say. The
  // op is also addressed cell by cell, so a locked cell elsewhere in the table is not reached
  // either — classifying it at the TABLE would have frozen every cell in it.
  test('shading a cell does not reach the content a control inside it holds', () => {
    const part = tableHolding(contentLocked);
    const cells = nodesOfKind(part, 'tableCell');
    for (const cell of [cells[0]!, cells[1]!]) {
      expect(
        refusal(part, {
          op: 'setTableCellFill',
          tableId: tableId(part),
          cellIds: [cell.id],
          color: null,
        })
      ).not.toBe('locked');
    }
  });

  // A control ENCLOSING the cell is a different question, and it is refused: the shading lands
  // inside content that control declares off limits.
  test('shading a cell inside a locked control is refused', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:tbl><w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>` +
        `<w:tr><w:tc><w:p><w:r><w:t>held</w:t></w:r></w:p></w:tc></w:tr>` +
        `</w:tbl></w:sdtContent></w:sdt>`
    );
    const cell = nodesOfKind(part, 'tableCell')[0]!;
    expect(
      refusal(part, {
        op: 'setTableCellFill',
        tableId: tableId(part),
        cellIds: [cell.id],
        color: null,
      })
    ).toBe('locked');
  });

  // A page-number refresh rewrites the runs of the paragraphs it names, wherever they are.
  test('refreshing TOC page numbers into a locked paragraph is refused', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="contentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>Heading\t1</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const paragraph = nodesOfKind(part, 'paragraph')[0]!;
    expect(
      refusal(part, {
        op: 'rewriteTocPageNumbers',
        tocId: 'toc',
        updates: [{ paragraphId: paragraph.id, pageNumberText: '2' }],
      })
    ).toBe('locked');
  });

  // Both repeating-section ops are refused as unsupported today. Their reach is asserted
  // directly so the refusal they get the day they are implemented is the control's, not a
  // classification nobody revisited.
  test('repeating-section items are addressed at the control that declares them', () => {
    expect(treeOpReach({ op: 'addRepeatingSectionItem', controlId: 'c1' })).toEqual({
      kind: 'control',
      controlId: 'c1',
      intent: 'value',
    });
    expect(treeOpReach({ op: 'removeRepeatingSectionItem', controlId: 'c1', index: 0 })).toEqual({
      kind: 'control',
      controlId: 'c1',
      intent: 'value',
      replacesContent: true,
    });
  });

  // Reach is resolved before validation, so a malformed list must produce a refusal rather
  // than a thrown exception from the classification itself.
  test('a list-shaped op that is not a list is classified without throwing', () => {
    const part = parseDoc(`<w:p><w:r><w:t>text</w:t></w:r></w:p>`);
    const op = { op: 'rewriteTocPageNumbers', tocId: 'toc', updates: null } as unknown as TreeDocOp;
    expect(treeOpReach(op)).toEqual({ kind: 'nodes', targets: [] });
    expect(refusal(part, op)).not.toBeNull();
  });
});

describe('reads and lifecycle are not writes', () => {
  // The failure mode on the other side of failing closed: classifying everything as a mutation
  // would refuse a header's creation in any document that happens to hold a locked field, which
  // has nothing to do with the field.
  test('creating and deleting a header is not refused by a locked body control', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>locked</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    // Not `null` necessarily — these ops have their own preconditions — but never `locked`.
    expect(
      refusal(part, { op: 'createHeaderFooter', kind: 'header', variant: 'default' })
    ).not.toBe('locked');
    expect(refusal(part, { op: 'linkToPrevious', kind: 'header', sectionIndex: 0 })).not.toBe(
      'locked'
    );
  });

  test('a write addressed to the control itself is still the control op path', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>old</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const control = contentControlsIn(part.root)[0]!;
    expect(
      refusal(part, {
        op: 'setContentControlValue',
        controlId: control.node.id,
        value: { kind: 'text', text: 'new' },
      })
    ).toBeNull();
  });

  test('an ordinary edit outside every control is untouched by all of this', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="t"/><w:lock w:val="sdtContentLocked"/></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>locked</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `<w:p><w:r><w:t>free</w:t></w:r></w:p>`
    );
    const outside = paragraphs(part)[1]!;
    expect(
      refusal(part, { op: 'insertText', paragraphId: outside.id, offset: 0, text: 'x' })
    ).toBeNull();
  });
});
