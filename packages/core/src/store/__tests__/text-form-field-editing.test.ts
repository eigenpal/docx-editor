import { describe, expect, test } from 'bun:test';
import {
  applyTreeOp,
  readOoxmlPart,
  serializeOoxmlPart,
  paragraphTextOf,
  type OoxmlParagraphNode,
  type OoxmlPart,
} from '../index.ts';
import { textFormFieldsOf, textFormFieldForEdit } from '../store/text-form-fields.ts';
import { applyProtectedTextFormEdit } from '../store/tree-op-field-results.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};
function fixture(wrapper = '', locked = false): OoxmlPart {
  const field =
    '<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="InputA"/><w:enabled/><w:textInput><w:default w:val="Sample"/></w:textInput></w:ffData></w:fldChar></w:r><w:bookmarkStart w:id="42" w:name="InputA"/><w:r><w:instrText> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Sample</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:bookmarkEnd w:id="42"/>';
  const inside = wrapper ? `<w:${wrapper}>${field}</w:${wrapper}>` : field;
  const content = locked
    ? `<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent>${inside}</w:sdtContent></w:sdt>`
    : inside;
  const parsed = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>A</w:t></w:r>${content}<w:r><w:t>Z</w:t></w:r></w:p></w:body></w:document>`,
    metadata
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}
function paragraph(part: OoxmlPart): OoxmlParagraphNode {
  const body = part.root.children[0];
  if (!body || body.kind === 'textValue') throw new Error('body');
  return body.children[0] as OoxmlParagraphNode;
}

describe('legacy text form editing', () => {
  for (const wrapper of ['', 'smartTag', 'customXml', 'dir', 'bdo']) {
    test(`whole-result deletion removes field definition through ${wrapper || 'plain runs'}`, () => {
      const part = fixture(wrapper);
      const p = paragraph(part);
      expect(textFormFieldsOf(p)[0]).toMatchObject({ start: 1, end: 7 });
      const result = applyTreeOp(part, { op: 'deleteText', paragraphId: p.id, start: 1, end: 7 });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(paragraphTextOf(result.part, p.id)).toBe('AZ');
      expect(serializeOoxmlPart(result.part)).not.toContain('FORMTEXT');
      expect(serializeOoxmlPart(result.part)).not.toContain('bookmarkStart');
      if (wrapper) expect(serializeOoxmlPart(result.part)).toContain(`<w:${wrapper}`);
    });
  }
  test('partial deletion keeps field definition', () => {
    const part = fixture();
    const p = paragraph(part);
    const result = applyTreeOp(part, { op: 'deleteText', paragraphId: p.id, start: 2, end: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(serializeOoxmlPart(result.part)).toContain('FORMTEXT');
  });
  test('options change the default and result while retaining the field', () => {
    const part = fixture();
    const p = paragraph(part);
    const f = textFormFieldsOf(p)[0]!;
    const result = applyTreeOp(part, {
      op: 'setTextFormFieldDefault',
      paragraphId: p.id,
      fieldNodeId: f.fieldNodeId,
      text: 'Updated',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(paragraphTextOf(result.part, p.id)).toBe('AUpdatedZ');
    expect(textFormFieldsOf(paragraph(result.part))[0]?.defaultText).toBe('Updated');
  });
  test('protected replacement retains the field and original default through an empty result', () => {
    let part = fixture();
    const id = paragraph(part).id;
    const deletion = { op: 'deleteText', paragraphId: id, start: 1, end: 7 } as const;
    const field = textFormFieldForEdit(part, deletion)!;
    const removed = applyProtectedTextFormEdit(part, deletion, field);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    part = removed.part;
    const insertion = { op: 'insertText', paragraphId: id, offset: 1, text: 'Filled' } as const;
    const empty = textFormFieldForEdit(part, insertion)!;
    expect(empty).not.toBeNull();
    const filled = applyProtectedTextFormEdit(part, insertion, empty);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    expect(paragraphTextOf(filled.part, id)).toBe('AFilledZ');
    expect(textFormFieldsOf(paragraph(filled.part))[0]?.defaultText).toBe('Sample');
  });
  test('protected filling cannot bypass content locks', () => {
    const part = fixture('', true);
    const p = paragraph(part);
    const op = { op: 'deleteText', paragraphId: p.id, start: 1, end: 7 } as const;
    expect(applyProtectedTextFormEdit(part, op, textFormFieldForEdit(part, op)!)).toMatchObject({
      ok: false,
      reason: 'locked',
    });
  });
});

test('package transaction fills a protected field and preserves it across delete plus insert', async () => {
  const { TreeDocumentStore } = await import('../index.ts');
  const part = fixture();
  const id = paragraph(part).id;
  const parsed = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`,
    {
      name: '/word/settings.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
    }
  );
  if (!parsed.ok) throw new Error(parsed.reason);
  const store = new TreeDocumentStore(part, { settingsPart: () => parsed.part });
  expect(
    store.transact((ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId: id, start: 1, end: 7 });
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 1, text: 'Completed' });
    }).ok
  ).toBe(true);
  expect(
    store.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 0, text: 'Blocked' })
    ).ok
  ).toBe(false);
  expect(
    store.transact((ctx) =>
      ctx.apply({
        op: 'setTextFormFieldDefault',
        paragraphId: id,
        fieldNodeId: textFormFieldsOf(paragraph(part))[0]!.fieldNodeId,
        text: 'Blocked',
      })
    ).ok
  ).toBe(false);
});

function fromXml(xml: string): OoxmlPart {
  const parsed = readOoxmlPart(xml, metadata);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.part;
}

test('protected partial edits retain the formatting of unaffected result runs', () => {
  const part = fromXml(
    serializeOoxmlPart(fixture()).replace(
      '<w:r><w:t>Sample</w:t></w:r>',
      '<w:r><w:rPr><w:b/></w:rPr><w:t>AB</w:t></w:r><w:r><w:t>CD</w:t></w:r>'
    )
  );
  const p = paragraph(part);
  const op = { op: 'deleteText', paragraphId: p.id, start: 1, end: 2 } as const;
  const result = applyProtectedTextFormEdit(part, op, textFormFieldForEdit(part, op)!);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(serializeOoxmlPart(result.part)).toContain(
    '<w:r><w:rPr><w:b/></w:rPr><w:t>B</w:t></w:r><w:r><w:t>CD</w:t></w:r>'
  );
});

for (const depth of [17, 31])
  test(`field options and protected edits share inline depth at ${depth}`, () => {
    const xml = serializeOoxmlPart(fixture('smartTag'))
      .replace('<w:smartTag>', '<w:smartTag>'.repeat(depth))
      .replace('</w:smartTag>', '</w:smartTag>'.repeat(depth));
    const part = fromXml(xml);
    const p = paragraph(part);
    const field = textFormFieldsOf(p)[0]!;
    expect(field).toBeDefined();
    expect(
      applyTreeOp(part, {
        op: 'setTextFormFieldDefault',
        paragraphId: p.id,
        fieldNodeId: field.fieldNodeId,
        text: 'Updated',
      }).ok
    ).toBe(true);
    expect(
      applyProtectedTextFormEdit(
        part,
        { op: 'deleteText', paragraphId: p.id, start: 1, end: 2 },
        field
      ).ok
    ).toBe(true);
  });

test('protected replacement keeps the second adjacent field as its target', async () => {
  const { TreeDocumentStore } = await import('../index.ts');
  const xml = serializeOoxmlPart(fixture());
  const fieldXml = xml.slice(xml.indexOf('<w:r><w:fldChar'), xml.indexOf('<w:r><w:t>Z'));
  const part = fromXml(
    xml.replace(
      '<w:r><w:t>Z</w:t></w:r>',
      fieldXml.replaceAll('InputA', 'InputB').replaceAll('42', '43')
    )
  );
  const id = paragraph(part).id;
  const settings = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`,
    {
      name: '/word/settings.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
    }
  );
  if (!settings.ok) throw new Error(settings.reason);
  const store = new TreeDocumentStore(part, { settingsPart: () => settings.part });
  const secondId = textFormFieldsOf(paragraph(part))[1]!.fieldNodeId;
  expect(
    store.transact((ctx) => {
      ctx.apply({ op: 'deleteText', paragraphId: id, start: 7, end: 13 });
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 7, text: 'New' });
    }).ok
  ).toBe(true);
  expect(paragraphTextOf(store.part, id)).toBe('ASampleNew');
  expect(
    store.transact((ctx) =>
      ctx.apply({ op: 'insertText', paragraphId: id, offset: 7, text: 'More' })
    ).ok
  ).toBe(true);
  expect(paragraphTextOf(store.part, id)).toBe('ASampleMoreNew');
  expect(
    store.transact((ctx) =>
      ctx.apply({
        op: 'deleteText',
        paragraphId: id,
        start: 11,
        end: 14,
        textFormFieldId: secondId,
      })
    ).ok
  ).toBe(true);
  const firstId = textFormFieldsOf(paragraph(store.part))[0]!.fieldNodeId;
  expect(
    store.transact((ctx) =>
      ctx.apply({
        op: 'insertText',
        paragraphId: id,
        offset: 11,
        text: 'Tail',
        textFormFieldId: firstId,
      })
    ).ok
  ).toBe(true);

  expect(textFormFieldsOf(paragraph(store.part))[1]).toMatchObject({
    fieldNodeId: secondId,
    start: 15,
    end: 15,
  });
});

test('an empty legacy text form without a cached run accepts filling and options edits', () => {
  const part = fromXml(serializeOoxmlPart(fixture()).replace('<w:r><w:t>Sample</w:t></w:r>', ''));
  const p = paragraph(part);
  const field = textFormFieldsOf(p)[0]!;
  const insertion = { op: 'insertText', paragraphId: p.id, offset: 1, text: 'Filled' } as const;
  const filled = applyProtectedTextFormEdit(part, insertion, field);
  expect(filled.ok).toBe(true);
  if (filled.ok) expect(paragraphTextOf(filled.part, p.id)).toBe('AFilledZ');
  const options = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: p.id,
    fieldNodeId: field.fieldNodeId,
    text: 'Default',
  });
  expect(options.ok).toBe(true);
  if (options.ok) expect(paragraphTextOf(options.part, p.id)).toBe('ADefaultZ');
});

test('a forged text form identity cannot remove a protected definition inside an unlocked control', async () => {
  const { TreeDocumentStore } = await import('../index.ts');
  const part = fromXml(
    serializeOoxmlPart(fixture('', true)).replace('<w:lock w:val="contentLocked"/>', '')
  );
  const id = paragraph(part).id;
  const settings = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`,
    {
      name: '/word/settings.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
    }
  );
  if (!settings.ok) throw new Error(settings.reason);
  const store = new TreeDocumentStore(part, { settingsPart: () => settings.part });
  const before = serializeOoxmlPart(store.part);
  expect(
    store.transact((ctx) =>
      ctx.apply({ op: 'deleteText', paragraphId: id, start: 1, end: 7, textFormFieldId: 'missing' })
    ).ok
  ).toBe(false);
  expect(serializeOoxmlPart(store.part)).toBe(before);
});

test('protected field insertion validates its result rather than the following locked control', () => {
  const part = fromXml(
    serializeOoxmlPart(fixture()).replace(
      '<w:r><w:t>Z</w:t></w:r>',
      '<w:sdt><w:sdtPr><w:lock w:val="contentLocked"/></w:sdtPr><w:sdtContent><w:r><w:t>Z</w:t></w:r></w:sdtContent></w:sdt>'
    )
  );
  const p = paragraph(part);
  const field = textFormFieldsOf(p)[0]!;
  const result = applyProtectedTextFormEdit(
    part,
    {
      op: 'insertText',
      paragraphId: p.id,
      offset: 7,
      text: 'X',
      textFormFieldId: field.fieldNodeId,
    },
    field
  );
  expect(result.ok).toBe(true);
  if (result.ok) expect(paragraphTextOf(result.part, p.id)).toBe('ASampleXZ');
});

test('options store type, maximum length, format, and enabled beside the unchanged bookmark', () => {
  const part = fixture('customXml');
  const p = paragraph(part);
  const field = textFormFieldsOf(p)[0]!;
  const result = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: p.id,
    fieldNodeId: field.fieldNodeId,
    text: '1234.5',
    options: { type: 'number', maxLength: 6, format: '#,##0.00', enabled: false },
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(paragraphTextOf(result.part, p.id)).toBe('A1,234.50Z');
  expect(textFormFieldsOf(paragraph(result.part))[0]).toMatchObject({
    type: 'number',
    maxLength: 6,
    format: '#,##0.00',
    enabled: false,
    defaultText: '1234.5',
  });
  const xml = serializeOoxmlPart(result.part);
  expect(xml).toContain('bookmarkStart');
  expect(xml).toContain('customXml');
  expect(xml.indexOf('<w:type')).toBeLessThan(xml.indexOf('<w:default'));
  expect(xml.indexOf('<w:default')).toBeLessThan(xml.indexOf('<w:maxLength'));
  expect(xml.indexOf('<w:maxLength')).toBeLessThan(xml.indexOf('<w:format'));
});

test('options refuse invalid values atomically', () => {
  const part = fixture();
  const p = paragraph(part);
  const f = textFormFieldsOf(p)[0]!;
  for (const [text, options] of [
    ['invalid', { type: 'number', maxLength: 0, format: '', enabled: true }],
    ['2025-02-29', { type: 'date', maxLength: 0, format: 'yyyy-MM-dd', enabled: true }],
    ['long', { type: 'regular', maxLength: 3, format: '', enabled: true }],
    ['', { type: 'regular', maxLength: -1, format: '', enabled: true }],
    ['', { type: 'regular', maxLength: 0, format: 'invalid', enabled: true }],
  ] as const) {
    expect(
      applyTreeOp(part, {
        op: 'setTextFormFieldDefault',
        paragraphId: p.id,
        fieldNodeId: f.fieldNodeId,
        text,
        options,
      }).ok
    ).toBe(false);
  }
  expect(paragraphTextOf(part, p.id)).toBe('ASampleZ');
});

test('protected length accepts Unicode characters, rejects overflow, and permits reducing existing overflow', () => {
  const part = fixture();
  const p = paragraph(part);
  const f = textFormFieldsOf(p)[0]!;
  const configured = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: p.id,
    fieldNodeId: f.fieldNodeId,
    text: '😀',
    options: { type: 'regular', maxLength: 2, format: '', enabled: true },
  });
  expect(configured.ok).toBe(true);
  if (!configured.ok) return;
  const field = textFormFieldsOf(paragraph(configured.part))[0]!;
  const added = applyProtectedTextFormEdit(
    configured.part,
    { op: 'insertText', paragraphId: p.id, offset: field.end, text: 'b' },
    field
  );
  expect(added.ok).toBe(true);
  if (!added.ok) return;
  const full = textFormFieldsOf(paragraph(added.part))[0]!;
  expect(
    applyProtectedTextFormEdit(
      added.part,
      { op: 'insertText', paragraphId: p.id, offset: full.end, text: 'c' },
      full
    ).ok
  ).toBe(false);
  const small = { ...full, maxLength: 1 };
  expect(
    applyProtectedTextFormEdit(
      added.part,
      { op: 'deleteText', paragraphId: p.id, start: 1, end: 3 },
      small
    ).ok
  ).toBe(true);
});

test('finish filling formats only the result and retains the default', () => {
  const part = fixture();
  const p = paragraph(part);
  const f = textFormFieldsOf(p)[0]!;
  const configured = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: p.id,
    fieldNodeId: f.fieldNodeId,
    text: 'Seed',
    options: { type: 'regular', maxLength: 0, format: 'First capital', enabled: true },
  });
  expect(configured.ok).toBe(true);
  if (!configured.ok) return;
  let next = configured.part;
  let field = textFormFieldsOf(paragraph(next))[0]!;
  const erased = applyProtectedTextFormEdit(
    next,
    { op: 'deleteText', paragraphId: p.id, start: field.start, end: field.end },
    field
  );
  expect(erased.ok).toBe(true);
  if (!erased.ok) return;
  next = erased.part;
  field = textFormFieldsOf(paragraph(next))[0]!;
  const typed = applyProtectedTextFormEdit(
    next,
    { op: 'insertText', paragraphId: p.id, offset: field.start, text: 'mARY SMITH' },
    field
  );
  expect(typed.ok).toBe(true);
  if (!typed.ok) return;
  const finished = applyTreeOp(typed.part, {
    op: 'commitTextFormField',
    paragraphId: p.id,
    fieldNodeId: f.fieldNodeId,
  });
  expect(finished.ok).toBe(true);
  if (!finished.ok) return;
  expect(paragraphTextOf(finished.part, p.id)).toBe('AMary smithZ');
  expect(textFormFieldsOf(paragraph(finished.part))[0]?.defaultText).toBe('Seed');
});

test('protected outer deletion cannot discard a form field through an unlocked content control', async () => {
  const { TreeDocumentStore } = await import('../index.ts');
  const settings = readOoxmlPart(
    `<w:settings xmlns:w="${W}"><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`,
    {
      name: '/word/settings.xml',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml',
    }
  );
  if (!settings.ok) throw new Error(settings.reason);
  for (const enabled of [true, false]) {
    const part = fromXml(
      serializeOoxmlPart(fixture('', true))
        .replace('<w:lock w:val="contentLocked"/>', '')
        .replace('<w:enabled/>', `<w:enabled w:val="${enabled ? '1' : '0'}"/>`)
    );
    const id = paragraph(part).id;
    const store = new TreeDocumentStore(part, { settingsPart: () => settings.part });
    expect(
      store.transact((ctx) => ctx.apply({ op: 'deleteText', paragraphId: id, start: 0, end: 8 })).ok
    ).toBe(false);
    expect(serializeOoxmlPart(store.part)).toContain('FORMTEXT');
  }
});

test('maximum length excludes generated numeric grouping when correcting a filled value', () => {
  const part = fixture();
  const p = paragraph(part);
  const f = textFormFieldsOf(p)[0]!;
  const configured = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: p.id,
    fieldNodeId: f.fieldNodeId,
    text: '1000',
    options: { type: 'number', maxLength: 4, format: '#,##0', enabled: true },
  });
  expect(configured.ok).toBe(true);
  if (!configured.ok) return;
  const field = textFormFieldsOf(paragraph(configured.part))[0]!;
  const removed = applyProtectedTextFormEdit(
    configured.part,
    { op: 'deleteText', paragraphId: p.id, start: field.end - 1, end: field.end },
    field
  );
  expect(removed.ok).toBe(true);
  if (!removed.ok) return;
  const shorter = textFormFieldsOf(paragraph(removed.part))[0]!;
  const inserted = applyProtectedTextFormEdit(
    removed.part,
    { op: 'insertText', paragraphId: p.id, offset: shorter.end, text: '1' },
    shorter
  );
  expect(inserted.ok).toBe(true);
  if (!inserted.ok) return;
  expect(paragraphTextOf(inserted.part, p.id)).toBe('A1,001Z');
});

test('generated decimal and named-date formats do not consume the raw input limit', () => {
  for (const config of [
    {
      text: '1',
      options: { type: 'number', maxLength: 1, format: '0.00', enabled: true },
      expected: 'A2.00Z',
    },
    {
      text: '1/1/2030',
      options: { type: 'date', maxLength: 8, format: 'MMMM d, yyyy', enabled: true },
      expected: 'AJanuary 2, 2030Z',
    },
  ] as const) {
    const part = fixture();
    const p = paragraph(part);
    const f = textFormFieldsOf(p)[0]!;
    const configured = applyTreeOp(part, {
      op: 'setTextFormFieldDefault',
      paragraphId: p.id,
      fieldNodeId: f.fieldNodeId,
      ...config,
    });
    expect(configured.ok).toBe(true);
    if (!configured.ok) continue;
    const field = textFormFieldsOf(paragraph(configured.part))[0]!;
    const start = config.options.type === 'date' ? field.start + 8 : field.start;
    const removed = applyProtectedTextFormEdit(
      configured.part,
      { op: 'deleteText', paragraphId: p.id, start, end: start + 1 },
      field
    );
    expect(removed.ok).toBe(true);
    if (!removed.ok) continue;
    const shorter = textFormFieldsOf(paragraph(removed.part))[0]!;
    const inserted = applyProtectedTextFormEdit(
      removed.part,
      { op: 'insertText', paragraphId: p.id, offset: start, text: '2' },
      shorter
    );
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) continue;
    expect(paragraphTextOf(inserted.part, p.id)).toBe(config.expected);
  }
});

test('new input cannot reuse generated decimal padding to exceed maximum length', () => {
  const part = fixture();
  const p = paragraph(part);
  const f = textFormFieldsOf(p)[0]!;
  const configured = applyTreeOp(part, {
    op: 'setTextFormFieldDefault',
    paragraphId: p.id,
    fieldNodeId: f.fieldNodeId,
    text: '1',
    options: { type: 'number', maxLength: 1, format: '0.00', enabled: true },
  });
  expect(configured.ok).toBe(true);
  if (!configured.ok) return;
  const field = textFormFieldsOf(paragraph(configured.part))[0]!;
  expect(
    applyProtectedTextFormEdit(
      configured.part,
      { op: 'insertText', paragraphId: p.id, offset: field.end, text: '000000' },
      field
    ).ok
  ).toBe(false);
});
