// Store-level content-control value and unwrap ops (`setContentControlValue`,
// `removeContentControl`), plus transparent inline offset accounting through `w:sdt`.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../package/ooxml-tree.ts';
import { serializeOoxmlPart } from '../package/ooxml-serialize.ts';
import { applyTreeOp, paragraphTextOf, type TreeDocOp } from '../store/tree-ops.ts';
import { segmentsOf } from '../store/tree-op-validate.ts';
import {
  findContentControl,
  hasGlossaryPlaceholderRef,
  isShowingPlaceholder,
} from '../store/tree-op-nodes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

function load(body: string, extra = ''): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}" xmlns:w15="${W15}"${extra}><w:body>${body}</w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.part;
}

function reject(part: OoxmlPart, op: TreeDocOp): string {
  const result = applyTreeOp(part, op);
  if (result.ok) throw new Error('expected a rejection');
  return result.reason;
}

function findById(node: OoxmlNode, id: string): OoxmlNode | null {
  if (node.kind === 'textValue') return node.id === id ? node : null;
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

function firstSdt(part: OoxmlPart): OoxmlNode {
  const walk = (node: OoxmlNode): OoxmlNode | null => {
    if (node.kind === 'textValue') return null;
    if (node.localName === 'sdt') return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  const found = walk(part.root);
  if (!found) throw new Error('no sdt');
  return found;
}

function attributeOf(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue') return undefined;
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

function childNamed(parent: OoxmlNode, localName: string): OoxmlNode | undefined {
  if (parent.kind === 'textValue') return undefined;
  return parent.children.find(
    (child) => child.kind !== 'textValue' && child.localName === localName
  );
}

const PARAGRAPH = '/word/document.xml#0.0.0';

describe('inline content controls contribute UTF-16 offsets', () => {
  test('segmentsOf includes runs inside an inline sdt', () => {
    const part = load(
      '<w:p><w:r><w:t>before </w:t></w:r>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>mid</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t> after</w:t></w:r></w:p>'
    );
    const paragraph = findById(part.root, PARAGRAPH);
    expect(paragraph?.kind).toBe('paragraph');
    if (!paragraph || paragraph.kind !== 'paragraph') throw new Error('no paragraph');
    expect(paragraphTextOf(part, PARAGRAPH)).toBe('before mid after');
    expect(segmentsOf(paragraph).at(-1)?.end).toBe(16);
  });

  test('deleteText can erase text inside an inline control', () => {
    const part = load(
      '<w:p><w:r><w:t>ab</w:t></w:r>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>CD</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>ef</w:t></w:r></w:p>'
    );
    const next = apply(part, { op: 'deleteText', paragraphId: PARAGRAPH, start: 2, end: 4 });
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('abef');
    expect(firstSdt(next)).toBeTruthy();
  });
});

describe('setContentControlValue', () => {
  test('text control replaces content and clears showingPlcHdr', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>Enter name</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdt(part);
    const next = apply(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: 'Ada',
    });
    const updated = findContentControl(next, control.id)!;
    expect(childNamed(childNamed(updated, 'sdtPr')!, 'showingPlcHdr')).toBeUndefined();
    const content = childNamed(updated, 'sdtContent')!;
    const text = [
      ...(function* walk(node: OoxmlNode): Generator<string> {
        if (node.kind === 'textValue') {
          yield node.value;
          return;
        }
        for (const child of node.children) yield* walk(child);
      })(content),
    ].join('');
    expect(text).toBe('Ada');
    expect(updated.id).toBe(control.id);
  });

  test('dropdown accepts a listed value and updates lastValue', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:dropDownList>' +
        '<w:listItem w:displayText="One" w:value="1"/>' +
        '<w:listItem w:displayText="Two" w:value="2"/>' +
        '</w:dropDownList></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>One</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdt(part);
    expect(reject(part, { op: 'setContentControlValue', controlId: control.id, value: '9' })).toBe(
      'invalidArgs'
    );
    const next = apply(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: '2',
    });
    const list = childNamed(
      childNamed(findContentControl(next, control.id)!, 'sdtPr')!,
      'dropDownList'
    )!;
    expect(attributeOf(list, 'lastValue')).toBe('2');
  });

  test('combo accepts a free value', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:comboBox>' +
        '<w:listItem w:displayText="Red" w:value="r"/>' +
        '</w:comboBox></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>Red</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdt(part);
    const next = apply(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: 'custom',
    });
    const list = childNamed(
      childNamed(findContentControl(next, control.id)!, 'sdtPr')!,
      'comboBox'
    )!;
    expect(attributeOf(list, 'lastValue')).toBe('custom');
  });

  test('checkbox toggles w14:checked and rewrites the glyph', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w14:checkbox>' +
        '<w14:checked w14:val="0"/>' +
        '<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>' +
        '<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>' +
        '</w14:checkbox></w:sdtPr>' +
        '<w:sdtContent><w:r><w:sym w:font="MS Gothic" w:char="2610"/></w:r></w:sdtContent>' +
        '</w:sdt></w:p>'
    );
    const control = firstSdt(part);
    const next = apply(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: 'true',
    });
    const checkbox = childNamed(
      childNamed(findContentControl(next, control.id)!, 'sdtPr')!,
      'checkbox'
    )!;
    const checked = childNamed(checkbox, 'checked')!;
    expect(attributeOf(checked, 'val')).toBe('1');
    const walk = (node: OoxmlNode): OoxmlNode | null => {
      if (node.kind !== 'textValue' && node.localName === 'sym') return node;
      if (node.kind === 'textValue') return null;
      for (const child of node.children) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    expect(attributeOf(walk(findContentControl(next, control.id)!)!, 'char')).toBe('2612');
  });

  test('date writes fullDate and formatted display text', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:date w:fullDate="2020-01-01T00:00:00Z">' +
        '<w:dateFormat w:val="yyyy-MM-dd"/>' +
        '</w:date></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>2020-01-01</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdt(part);
    const next = apply(part, {
      op: 'setContentControlValue',
      controlId: control.id,
      value: '2024-07-04',
    });
    const date = childNamed(childNamed(findContentControl(next, control.id)!, 'sdtPr')!, 'date')!;
    expect(attributeOf(date, 'fullDate')).toBe('2024-07-04T00:00:00Z');
    expect(collectText(childNamed(findContentControl(next, control.id)!, 'sdtContent')!)).toBe(
      '2024-07-04'
    );
  });

  test('date accepts leap-day and normalizes date-time zones', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:date w:fullDate="2020-01-01T00:00:00Z">' +
        '<w:dateFormat w:val="yyyy-MM-dd"/>' +
        '</w:date></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>2020-01-01</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const id = firstSdt(part).id;
    const leap = apply(part, {
      op: 'setContentControlValue',
      controlId: id,
      value: '2024-02-29T15:30:00+02:00',
    });
    expect(
      attributeOf(
        childNamed(childNamed(findContentControl(leap, id)!, 'sdtPr')!, 'date')!,
        'fullDate'
      )
    ).toBe('2024-02-29T15:30:00+02:00');
  });

  test('date refuses impossible calendar dates and malformed suffixes', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:date w:fullDate="2020-01-01T00:00:00Z">' +
        '<w:dateFormat w:val="yyyy-MM-dd"/>' +
        '</w:date></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>2020-01-01</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const id = firstSdt(part).id;
    expect(reject(part, { op: 'setContentControlValue', controlId: id, value: '2024-02-31' })).toBe(
      'invalidArgs'
    );
    expect(reject(part, { op: 'setContentControlValue', controlId: id, value: '2023-02-29' })).toBe(
      'invalidArgs'
    );
    expect(reject(part, { op: 'setContentControlValue', controlId: id, value: '2024-04-31' })).toBe(
      'invalidArgs'
    );
    expect(
      reject(part, { op: 'setContentControlValue', controlId: id, value: '2024-01-01Tgarbage' })
    ).toBe('invalidArgs');
    expect(
      reject(part, { op: 'setContentControlValue', controlId: id, value: '2024-01-01 00:00:00Z' })
    ).toBe('invalidArgs');
  });

  test('bound controls refuse value edits', () => {
    const part = load(
      '<w:sdt><w:sdtPr>' +
        '<w:dataBinding w:xpath="/a" w:storeItemID="{GUID}"/>' +
        '<w:text/>' +
        '</w:sdtPr><w:sdtContent><w:p><w:r><w:t>x</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    expect(
      reject(part, {
        op: 'setContentControlValue',
        controlId: firstSdt(part).id,
        value: 'y',
      })
    ).toBe('bound');
  });

  test('repeating section ops are unsupported', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w15:repeatingSection/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>item</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const id = firstSdt(part).id;
    expect(reject(part, { op: 'addRepeatingSectionItem', controlId: id })).toBe('unsupported');
    expect(reject(part, { op: 'removeRepeatingSectionItem', controlId: id, index: 0 })).toBe(
      'unsupported'
    );
    expect(reject(part, { op: 'setContentControlValue', controlId: id, value: 'x' })).toBe(
      'unsupported'
    );
  });
});

describe('removeContentControl', () => {
  test('unwraps keeping content and identity of runs', () => {
    const part = load(
      '<w:p><w:r><w:t>a</w:t></w:r>' +
        '<w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>b</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>c</w:t></w:r></w:p>'
    );
    const control = firstSdt(part);
    const contentRun = childNamed(childNamed(control, 'sdtContent')!, 'r')!;
    const next = apply(part, { op: 'removeContentControl', controlId: control.id });
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('abc');
    expect(findContentControl(next, control.id)).toBeNull();
    expect(findById(next.root, contentRun.id)?.kind).toBe('run');
  });

  test('explicit remove publishes flow-structural impact', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>body</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const result = applyTreeOp(part, {
      op: 'removeContentControl',
      controlId: firstSdt(part).id,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.effect.impact).toBe('flow-structural');
    expect(paragraphTextOf(result.part, PARAGRAPH)).toBe('body');
  });

  test('preserves non-property extension children beside sdtContent', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr/><w:sdtContent><w:r><w:t>body</w:t></w:r></w:sdtContent>' +
        '<w:extLst><w:ext w:uri="{test}"/></w:extLst></w:sdt></w:p>'
    );
    const control = firstSdt(part);
    const extension = childNamed(control, 'extLst')!;
    const next = apply(part, { op: 'removeContentControl', controlId: control.id });
    expect(findContentControl(next, control.id)).toBeNull();
    expect(findById(next.root, extension.id)?.localName).toBe('extLst');
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('body');
  });

  test('refuses unwrap when duplicate sdtContent would drop authored markup', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr/>' +
        '<w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent>' +
        '<w:sdtContent><w:r><w:t>second</w:t></w:r></w:sdtContent>' +
        '</w:sdt></w:p>'
    );
    const control = firstSdt(part);
    expect(reject(part, { op: 'removeContentControl', controlId: control.id })).toBe(
      'tree-invariant'
    );
    expect(findContentControl(part, control.id)).not.toBeNull();
  });

  test('preserves foreign-namespace sdtPr/sdtEndPr siblings during unwrap', () => {
    const X = 'urn:hostile';
    const part = load(
      '<w:p><w:sdt><w:sdtPr/>' +
        `<x:sdtPr xmlns:x="${X}" x:keep="pr"/>` +
        '<w:sdtContent><w:r><w:t>body</w:t></w:r></w:sdtContent>' +
        `<x:sdtEndPr xmlns:x="${X}" x:keep="end"/>` +
        '</w:sdt></w:p>',
      ` xmlns:x="${X}"`
    );
    const control = firstSdt(part);
    const foreignPr = control.children.find(
      (child) =>
        child.kind !== 'textValue' && child.localName === 'sdtPr' && child.namespaceUri === X
    )!;
    const foreignEnd = control.children.find(
      (child) =>
        child.kind !== 'textValue' && child.localName === 'sdtEndPr' && child.namespaceUri === X
    )!;
    const next = apply(part, { op: 'removeContentControl', controlId: control.id });
    expect(findContentControl(next, control.id)).toBeNull();
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('body');
    expect(findById(next.root, foreignPr.id)?.namespaceUri).toBe(X);
    expect(findById(next.root, foreignEnd.id)?.namespaceUri).toBe(X);
    expect(serializeOoxmlPart(next)).toContain('x:keep="pr"');
    expect(serializeOoxmlPart(next)).toContain('x:keep="end"');
  });
});

function reopen(part: OoxmlPart): OoxmlPart {
  const saved = serializeOoxmlPart(part);
  const result = readOoxmlPart(saved, { name: part.name, contentType: part.contentType });
  if (!result.ok) throw new Error(`reopen failed: ${result.reason}`);
  return result.part;
}

function collectText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  return node.children.map(collectText).join('');
}

describe('showingPlcHdr first-input replacement', () => {
  test('insertText replaces the entire literal prompt and clears showingPlcHdr', () => {
    const part = load(
      '<w:p><w:r><w:t>x</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Enter name</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>y</w:t></w:r></w:p>'
    );
    const control = firstSdt(part);
    // Caret inside the prompt (offset 1 is past the leading "x").
    const next = apply(part, {
      op: 'insertText',
      paragraphId: PARAGRAPH,
      offset: 3,
      text: 'Ada',
    });
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('xAday');
    const updated = findContentControl(next, control.id)!;
    expect(isShowingPlaceholder(updated)).toBe(false);
    expect(collectText(childNamed(updated, 'sdtContent')!)).toBe('Ada');
  });

  test('foreign-namespace showingPlcHdr does not trigger destructive replacement', () => {
    const X = 'urn:ext';
    const part = load(
      '<w:p><w:sdt><w:sdtPr>' +
        `<x:showingPlcHdr xmlns:x="${X}" x:keep="1"/>` +
        '<w:text/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>REAL</w:t></w:r></w:sdtContent></w:sdt></w:p>',
      ` xmlns:x="${X}"`
    );
    const control = firstSdt(part);
    expect(isShowingPlaceholder(control)).toBe(false);
    const next = apply(part, {
      op: 'insertText',
      paragraphId: PARAGRAPH,
      offset: 2,
      text: 'X',
    });
    const updated = findContentControl(next, control.id)!;
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('REXAL');
    expect(collectText(childNamed(updated, 'sdtContent')!)).toBe('REXAL');
    const foreign = childNamed(childNamed(updated, 'sdtPr')!, 'showingPlcHdr');
    expect(foreign?.namespaceUri).toBe(X);
    expect(serializeOoxmlPart(next)).toContain('x:keep="1"');
  });

  test('save/reopen does not leave showingPlcHdr over user content', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>Enter project name</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const control = firstSdt(part);
    // Block control: the paragraph inside is the editable target.
    const innerPara = childNamed(childNamed(control, 'sdtContent')!, 'p')!;
    const next = apply(part, {
      op: 'insertText',
      paragraphId: innerPara.id,
      offset: 0,
      text: 'Apollo',
    });
    const reopened = reopen(next);
    const after = findContentControl(reopened, control.id)!;
    expect(isShowingPlaceholder(after)).toBe(false);
    expect(serializeOoxmlPart(reopened)).not.toContain('showingPlcHdr');
    expect(collectText(childNamed(after, 'sdtContent')!)).toBe('Apollo');
  });

  test('emptying after a placeholder replace does not restore showingPlcHdr (no glossary)', () => {
    // Honest limitation: without a durable glossary source this lane cannot restore a prompt.
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Prompt</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const control = firstSdt(part);
    const filled = apply(part, {
      op: 'insertText',
      paragraphId: PARAGRAPH,
      offset: 0,
      text: 'Hi',
    });
    expect(isShowingPlaceholder(findContentControl(filled, control.id)!)).toBe(false);
    const emptied = apply(filled, {
      op: 'deleteText',
      paragraphId: PARAGRAPH,
      start: 0,
      end: 2,
    });
    const after = findContentControl(emptied, control.id)!;
    expect(isShowingPlaceholder(after)).toBe(false);
    expect(paragraphTextOf(emptied, PARAGRAPH)).toBe('');
  });

  test('glossary docPart is preserved and still cannot invent a restore', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr>' +
        '<w:placeholder><w:docPart w:val="DefaultPlaceholder"/></w:placeholder>' +
        '<w:showingPlcHdr/><w:text/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>Click here</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const control = firstSdt(part);
    expect(hasGlossaryPlaceholderRef(control)).toBe(true);
    const filled = apply(part, {
      op: 'insertText',
      paragraphId: PARAGRAPH,
      offset: 0,
      text: 'Data',
    });
    const after = findContentControl(filled, control.id)!;
    expect(isShowingPlaceholder(after)).toBe(false);
    expect(hasGlossaryPlaceholderRef(after)).toBe(true);
    const emptied = apply(filled, {
      op: 'deleteText',
      paragraphId: PARAGRAPH,
      start: 0,
      end: 4,
    });
    // Still no restore: glossary is not resolved in this lane.
    expect(isShowingPlaceholder(findContentControl(emptied, control.id)!)).toBe(false);
  });

  test('bound refuses before a placeholder transition', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr>' +
        '<w:showingPlcHdr/>' +
        '<w:dataBinding w:xpath="/a" w:storeItemID="{G}"/>' +
        '<w:text/>' +
        '</w:sdtPr><w:sdtContent><w:r><w:t>Prompt</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    expect(reject(part, { op: 'insertText', paragraphId: PARAGRAPH, offset: 0, text: 'x' })).toBe(
      'bound'
    );
    expect(isShowingPlaceholder(firstSdt(part))).toBe(true);
  });
});

describe('w:temporary unwrap on first content edit', () => {
  test('insertText unwraps a temporary control keeping the edited content', () => {
    const part = load(
      '<w:p><w:r><w:t>a</w:t></w:r>' +
        '<w:sdt><w:sdtPr><w:temporary/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>b</w:t></w:r></w:sdtContent></w:sdt>' +
        '<w:r><w:t>c</w:t></w:r></w:p>'
    );
    const controlId = firstSdt(part).id;
    const next = apply(part, {
      op: 'insertText',
      paragraphId: PARAGRAPH,
      offset: 1,
      text: 'X',
    });
    expect(findContentControl(next, controlId)).toBeNull();
    expect(paragraphTextOf(next, PARAGRAPH)).toBe('aXbc');
  });

  test('placeholder replace and temporary unwrap share one write', () => {
    const part = load(
      '<w:p><w:sdt><w:sdtPr><w:temporary/><w:showingPlcHdr/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:r><w:t>Prompt</w:t></w:r></w:sdtContent></w:sdt></w:p>'
    );
    const controlId = firstSdt(part).id;
    const result = applyTreeOp(part, {
      op: 'insertText',
      paragraphId: PARAGRAPH,
      offset: 0,
      text: 'Ok',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.effect.impact).toBe('flow-structural');
    expect(findContentControl(result.part, controlId)).toBeNull();
    expect(paragraphTextOf(result.part, PARAGRAPH)).toBe('Ok');
  });

  test('setContentControlValue unwraps a temporary control', () => {
    const part = load(
      '<w:sdt><w:sdtPr><w:temporary/><w:text/></w:sdtPr>' +
        '<w:sdtContent><w:p><w:r><w:t>old</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    const controlId = firstSdt(part).id;
    const next = apply(part, {
      op: 'setContentControlValue',
      controlId,
      value: 'new',
    });
    expect(findContentControl(next, controlId)).toBeNull();
    expect(collectText(next.root)).toContain('new');
  });
});
