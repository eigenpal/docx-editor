// Content controls are written through the canonical op path, and only through it.
//
// One transaction per gesture, one refusal vocabulary for every caller: a value that does not
// belong to a dropdown, a control a template locked, a control bound to custom XML, and a
// control whose type does not match the value offered all answer a named rejection instead of
// a partial write.

import { describe, expect, test } from 'bun:test';
import {
  bodyStoryRoot,
  contentControlPropertiesOf,
  contentControlTextOf,
  contentControlsIn,
  paragraphOffsetIndex,
  readOoxmlPart,
  serializeOoxmlPart,
  storyParagraphs,
  type OoxmlNode,
  type OoxmlPart,
} from '../index.ts';
import { diffSemanticDigests, semanticDigest } from '../package/ooxml-digest.ts';
import { applyTreeOp } from '../store/tree-op-apply.ts';
import type { TreeDocOp, TreeOpRejection } from '../store/tree-op-types.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

const docMeta = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parseDoc(bodyInner: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${bodyInner}</w:body></w:document>`,
    docMeta
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function paragraphs(part: OoxmlPart): readonly OoxmlNode[] {
  const body = bodyStoryRoot(part);
  return body ? storyParagraphs(body) : [];
}

function controlIds(part: OoxmlPart): string[] {
  return contentControlsIn(part.root).map((entry) => entry.node.id);
}

function controlOf(part: OoxmlPart, index = 0): OoxmlNode {
  const found = contentControlsIn(part.root)[index];
  if (!found) throw new Error('no control');
  return found.node;
}

function apply(part: OoxmlPart, op: TreeDocOp): OoxmlPart {
  const result = applyTreeOp(part, op);
  if (!result.ok) throw new Error(`refused: ${result.reason}`);
  return result.part;
}

function refusal(part: OoxmlPart, op: TreeDocOp): TreeOpRejection | null {
  const result = applyTreeOp(part, op);
  return result.ok ? null : result.reason;
}

const PLAIN_TEXT = parseDoc(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="name"/><w:text/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>old</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

const DROPDOWN = parseDoc(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="pick"/><w:dropDownList>` +
    `<w:listItem w:displayText="Choose one" w:value="none"/>` +
    `<w:listItem w:displayText="Yes, please" w:value="yes"/></w:dropDownList></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>Choose one</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

const CHECKBOX = parseDoc(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="agree"/>` +
    `<w14:checkbox><w14:checked w14:val="0"/>` +
    `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
    `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>\u2610</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

const DATE = parseDoc(
  `<w:p><w:sdt><w:sdtPr><w:tag w:val="when"/>` +
    `<w:date w:fullDate="2020-01-02T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/>` +
    `<w:lid w:val="en-US"/></w:date></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>2020-01-02</w:t></w:r></w:sdtContent></w:sdt></w:p>`
);

describe('setContentControlValue writes the value each type accepts', () => {
  test('a plain-text control takes a string and keeps its run formatting', () => {
    const id = controlIds(PLAIN_TEXT)[0]!;
    const next = apply(PLAIN_TEXT, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'text', text: 'Ada' },
    });
    const control = controlOf(next);
    expect(contentControlTextOf(control)).toBe('Ada');
    // The control's own character formatting survives a value write.
    expect(serializeOoxmlPart(next)).toContain('<w:b/>');
  });

  test('a dropdown accepts a declared item and records it as the last value', () => {
    const id = controlIds(DROPDOWN)[0]!;
    const next = apply(DROPDOWN, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'listItem', value: 'yes' },
    });
    expect(contentControlTextOf(controlOf(next))).toBe('Yes, please');
    expect(contentControlPropertiesOf(controlOf(next)).lastValue).toBe('yes');
  });

  test('a dropdown refuses a value it does not declare', () => {
    const id = controlIds(DROPDOWN)[0]!;
    expect(
      refusal(DROPDOWN, {
        op: 'setContentControlValue',
        controlId: id,
        value: { kind: 'listItem', value: 'maybe' },
      })
    ).toBe('invalidArgs');
  });

  test('a combo box accepts free text a dropdown would refuse', () => {
    const combo = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:comboBox>` +
        `<w:listItem w:displayText="One" w:value="1"/></w:comboBox></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>One</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const id = controlIds(combo)[0]!;
    const next = apply(combo, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'text', text: 'something else' },
    });
    expect(contentControlTextOf(controlOf(next))).toBe('something else');
  });

  test('a checkbox writes the declared glyph and the checked flag together', () => {
    const id = controlIds(CHECKBOX)[0]!;
    const next = apply(CHECKBOX, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'checkbox', checked: true },
    });
    expect(contentControlPropertiesOf(controlOf(next)).checkbox?.checked).toBe(true);
    expect(contentControlTextOf(controlOf(next))).toBe('\u2612');
  });

  test('a date validates ISO input and writes fullDate beside the formatted content', () => {
    const id = controlIds(DATE)[0]!;
    const next = apply(DATE, {
      op: 'setContentControlValue',
      controlId: id,
      value: { kind: 'date', iso: '2024-03-09' },
    });
    expect(contentControlPropertiesOf(controlOf(next)).date?.fullDate).toBe('2024-03-09T00:00:00Z');
    expect(contentControlTextOf(controlOf(next))).toBe('2024-03-09');
    expect(
      refusal(DATE, {
        op: 'setContentControlValue',
        controlId: id,
        value: { kind: 'date', iso: 'the ninth of March' },
      })
    ).toBe('invalidArgs');
  });

  test('a value of the wrong shape for the control is a type mismatch', () => {
    expect(
      refusal(CHECKBOX, {
        op: 'setContentControlValue',
        controlId: controlIds(CHECKBOX)[0]!,
        value: { kind: 'text', text: 'yes' },
      })
    ).toBe('typeMismatch');
    expect(
      refusal(PLAIN_TEXT, {
        op: 'setContentControlValue',
        controlId: controlIds(PLAIN_TEXT)[0]!,
        value: { kind: 'checkbox', checked: true },
      })
    ).toBe('typeMismatch');
  });

  test('a control the file bound to custom XML refuses the write and keeps the binding', () => {
    const bound = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:dataBinding w:xpath="/root/name" w:storeItemID="{ABC}"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>bound</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    expect(
      refusal(bound, {
        op: 'setContentControlValue',
        controlId: controlIds(bound)[0]!,
        value: { kind: 'text', text: 'other' },
      })
    ).toBe('bound');
    expect(serializeOoxmlPart(bound)).toContain('w:storeItemID="{ABC}"');
  });

  test('an unknown control id is refused rather than ignored', () => {
    expect(
      refusal(PLAIN_TEXT, {
        op: 'setContentControlValue',
        controlId: 'no-such-node',
        value: { kind: 'text', text: 'x' },
      })
    ).toBe('unknown-content-control');
  });
});

describe('placeholder and temporary state are transitions, not text', () => {
  const PROMPT = parseDoc(
    `<w:p><w:sdt><w:sdtPr><w:tag w:val="prompt"/><w:showingPlcHdr/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>Click here to enter text.</w:t></w:r></w:sdtContent></w:sdt></w:p>`
  );

  test('the first value write replaces the whole prompt and clears the flag', () => {
    const next = apply(PROMPT, {
      op: 'setContentControlValue',
      controlId: controlIds(PROMPT)[0]!,
      value: { kind: 'text', text: 'A' },
    });
    const properties = contentControlPropertiesOf(controlOf(next));
    expect(properties.showingPlaceholder).toBe(false);
    expect(contentControlTextOf(controlOf(next))).toBe('A');
    expect(serializeOoxmlPart(next)).not.toContain('showingPlcHdr');
  });

  test('typing into the prompt through an ordinary text op replaces it too', () => {
    const paragraph = paragraphs(PROMPT)[0]!;
    const next = apply(PROMPT, {
      op: 'insertText',
      paragraphId: paragraph.id,
      offset: 0,
      text: 'A',
    });
    // Word does not leave "AClick here to enter text." behind: the prompt is state, and the
    // first character the user types is the control's whole content.
    expect(contentControlTextOf(controlOf(next))).toBe('A');
    expect(contentControlPropertiesOf(controlOf(next)).showingPlaceholder).toBe(false);
  });

  test('emptying the control restores the prompt and the flag', () => {
    const typed = apply(PROMPT, {
      op: 'setContentControlValue',
      controlId: controlIds(PROMPT)[0]!,
      value: { kind: 'text', text: 'A' },
    });
    const cleared = apply(typed, {
      op: 'setContentControlValue',
      controlId: controlIds(typed)[0]!,
      value: { kind: 'text', text: '' },
    });
    const properties = contentControlPropertiesOf(controlOf(cleared));
    expect(properties.showingPlaceholder).toBe(true);
    expect(contentControlTextOf(controlOf(cleared))).toBe('Click here to enter text.');
  });

  test('a temporary control removes its wrapper on the first content edit, keeping content', () => {
    const temporary = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="once"/><w:temporary/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>old</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const next = apply(temporary, {
      op: 'setContentControlValue',
      controlId: controlIds(temporary)[0]!,
      value: { kind: 'text', text: 'new' },
    });
    expect(contentControlsIn(next.root)).toHaveLength(0);
    expect(serializeOoxmlPart(next)).toContain('new');
  });

  test('a glossary reference is preserved and never resolved', () => {
    const glossary = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:placeholder><w:docPart w:val="DefaultPlaceholder_1"/></w:placeholder>` +
        `<w:showingPlcHdr/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>Enter a name</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    expect(contentControlPropertiesOf(controlOf(glossary)).placeholderDocPart).toBe(
      'DefaultPlaceholder_1'
    );
    const next = apply(glossary, {
      op: 'setContentControlValue',
      controlId: controlIds(glossary)[0]!,
      value: { kind: 'text', text: 'Ada' },
    });
    // The reference stays; the engine never reads the glossary part it names.
    expect(serializeOoxmlPart(next)).toContain('DefaultPlaceholder_1');
  });
});

// D9: a value edit is the only thing the file records. The digest is taken from the saved bytes
// and reopened bytes, so a difference here is a difference a consumer's Word would see, not an
// in-memory tree shape; every control the edit did not name must compare equal across it.
describe('a value edit survives save and reopen, and touches nothing else', () => {
  const THREE = parseDoc(
    `<w:p><w:sdt><w:sdtPr><w:tag w:val="one"/><w:id w:val="1"/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="two"/><w:id w:val="2"/><w:text/></w:sdtPr>` +
      `<w:sdtContent><w:r><w:t>second</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
      `<w:sdt><w:sdtPr><w:tag w:val="three"/><w:id w:val="3"/><w:dropDownList>` +
      `<w:listItem w:displayText="Yes" w:value="yes"/></w:dropDownList></w:sdtPr>` +
      `<w:sdtContent><w:p><w:r><w:t>Yes</w:t></w:r></w:p></w:sdtContent></w:sdt>`
  );

  test('the edited control reads its new value and the others are unchanged', () => {
    const before = contentControlsIn(THREE.root).map((entry) => entry.node.id);
    const edited = apply(THREE, {
      op: 'setContentControlValue',
      controlId: before[1]!,
      value: { kind: 'text', text: 'written' },
    });
    const reopened = readOoxmlPart(serializeOoxmlPart(edited), docMeta);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) throw new Error(reopened.reason);
    const texts = contentControlsIn(reopened.part.root).map((entry) =>
      contentControlTextOf(entry.node)
    );
    expect(texts).toEqual(['first', 'written', 'Yes']);
    const tags = contentControlsIn(reopened.part.root).map(
      (entry) => contentControlPropertiesOf(entry.node).tag
    );
    expect(tags).toEqual(['one', 'two', 'three']);
  });

  test('the semantic digest of the saved file differs only where the edit was', () => {
    const controls = contentControlsIn(THREE.root);
    const edited = apply(THREE, {
      op: 'setContentControlValue',
      controlId: controls[1]!.node.id,
      value: { kind: 'text', text: 'written' },
    });
    const reopen = (part: OoxmlPart): OoxmlPart => {
      const result = readOoxmlPart(serializeOoxmlPart(part), docMeta);
      if (!result.ok) throw new Error(result.reason);
      return result.part;
    };
    const differences = diffSemanticDigests(
      semanticDigest([reopen(THREE)]),
      semanticDigest([reopen(edited)])
    );
    // ONE difference, at the text of the one paragraph the write landed in. The controls either
    // side of it, their properties and the structure holding them all compare equal.
    expect(differences).toEqual([
      { path: '/word/document.xml.p[1].text', before: '"second"', after: '"written"' },
    ]);
    // And an unedited save is identical by digest, so the difference above is the edit.
    expect(
      diffSemanticDigests(semanticDigest([reopen(THREE)]), semanticDigest([reopen(reopen(THREE))]))
    ).toEqual([]);
  });

  // The oracle's whole job. Typing `w:sdt` moved an inline control's runs from a subtree
  // fingerprint onto a walk that digests properties and drops text, which would have made a
  // save that emptied a form field indistinguishable from one that kept its value.
  test('a control that lost its content is a reported loss, not a silent one', () => {
    const emptied = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="one"/><w:id w:val="1"/><w:text/></w:sdtPr>` +
        `<w:sdtContent/></w:sdt></w:p>` +
        `<w:p><w:sdt><w:sdtPr><w:tag w:val="two"/><w:id w:val="2"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>second</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
        `<w:sdt><w:sdtPr><w:tag w:val="three"/><w:id w:val="3"/><w:dropDownList>` +
        `<w:listItem w:displayText="Yes" w:value="yes"/></w:dropDownList></w:sdtPr>` +
        `<w:sdtContent><w:p><w:r><w:t>Yes</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    expect(
      diffSemanticDigests(semanticDigest([THREE]), semanticDigest([emptied])).map(
        (difference) => difference.path
      )
    ).toEqual(['/word/document.xml.p[0].text', '/word/document.xml.p[0].runProperties']);
  });

  // A tag, a lock or a type is the control's identity, and none of them is text.
  test('a control that lost its tag is a reported loss too', () => {
    const untagged = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:id w:val="1"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const tagged = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:tag w:val="one"/><w:id w:val="1"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>first</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    expect(diffSemanticDigests(semanticDigest([tagged]), semanticDigest([untagged]))).not.toEqual(
      []
    );
  });
});

describe('metadata, insertion and removal', () => {
  test('setContentControlProperties writes in schema order and leaves the rest alone', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:id w:val="5"/><w:text/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:t>v</w:t></w:r></w:sdtContent></w:sdt></w:p>`
    );
    const next = apply(part, {
      op: 'setContentControlProperties',
      controlId: controlIds(part)[0]!,
      tag: 'tagged',
      alias: 'Titled',
      lock: 'sdtLocked',
    });
    const properties = contentControlPropertiesOf(controlOf(next));
    expect([properties.tag, properties.alias, properties.lock, properties.id]).toEqual([
      'tagged',
      'Titled',
      'sdtLocked',
      5,
    ]);
    const xml = serializeOoxmlPart(next);
    expect(xml.indexOf('w:alias')).toBeLessThan(xml.indexOf('w:tag'));
    expect(xml.indexOf('w:tag')).toBeLessThan(xml.indexOf('w:id'));
    expect(xml.indexOf('w:id')).toBeLessThan(xml.indexOf('w:lock'));
    expect(xml.indexOf('w:lock')).toBeLessThan(xml.indexOf('w:text'));
  });

  test('insertContentControl wraps a range and allocates an id from the document maximum', () => {
    const part = parseDoc(
      `<w:p><w:sdt><w:sdtPr><w:id w:val="41"/></w:sdtPr><w:sdtContent><w:r><w:t>x</w:t></w:r></w:sdtContent></w:sdt></w:p>` +
        `<w:p><w:r><w:t>hello world</w:t></w:r></w:p>`
    );
    const paragraph = paragraphs(part)[1]!;
    const next = apply(part, {
      op: 'insertContentControl',
      paragraphId: paragraph.id,
      start: 0,
      end: 5,
      type: 'plainText',
      tag: 'greeting',
    });
    const inserted = contentControlsIn(next.root).find(
      (entry) => contentControlPropertiesOf(entry.node).tag === 'greeting'
    );
    expect(inserted).toBeDefined();
    expect(contentControlTextOf(inserted!.node)).toBe('hello');
    expect(contentControlPropertiesOf(inserted!.node).id).toBe(42);
    // The paragraph still reads the same characters — a wrapper is not an edit.
    expect(contentControlPropertiesOf(inserted!.node).type).toBe('plainText');
  });

  test('removeContentControl keeps the content it wrapped', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>kept</w:t></w:r></w:p></w:sdtContent></w:sdt>`
    );
    const next = apply(part, {
      op: 'removeContentControl',
      controlId: controlIds(part)[0]!,
      keepContent: true,
    });
    expect(contentControlsIn(next.root)).toHaveLength(0);
    expect(paragraphs(next)).toHaveLength(1);
    expect(serializeOoxmlPart(next)).toContain('kept');
  });

  test('removeContentControl can take the content with it', () => {
    const part = parseDoc(
      `<w:sdt><w:sdtPr><w:tag w:val="block"/></w:sdtPr><w:sdtContent>` +
        `<w:p><w:r><w:t>gone</w:t></w:r></w:p></w:sdtContent></w:sdt>` +
        `<w:p><w:r><w:t>stays</w:t></w:r></w:p>`
    );
    const next = apply(part, {
      op: 'removeContentControl',
      controlId: controlIds(part)[0]!,
      keepContent: false,
    });
    expect(serializeOoxmlPart(next)).not.toContain('gone');
    expect(serializeOoxmlPart(next)).toContain('stays');
  });
});

// AN OFFSET CANNOT SAY "APPEND TO THIS FIELD". A boundary offset belongs to the run that starts
// there, so the offset at an inline control's trailing edge is the text AFTER the control — the
// same ambiguity `setRunProperties` answers with `targetRunIds`, answered the same way.
describe('an insertion can name the control it belongs to', () => {
  const inline = () =>
    parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="f"/></w:sdtPr>` +
        `<w:sdtContent><w:r><w:rPr><w:b/></w:rPr><w:t>MID</w:t></w:r></w:sdtContent></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p>`
    );

  const spanOf = (part: OoxmlPart): { readonly start: number; readonly end: number } => {
    const control = contentControlsIn(part.root)[0]!;
    const found = paragraphOffsetIndex(paragraphs(part)[0] as never).spanOf(control.node);
    if (!found) throw new Error('the control has no span');
    return found;
  };

  test('the trailing edge appends inside the control instead of after it', () => {
    const part = inline();
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: spanOf(part).end,
      text: '#',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    expect(contentControlTextOf(contentControlsIn(next.root)[0]!.node)).toBe('MID#');
  });

  test('and it keeps the formatting of the run it appended to', () => {
    const part = inline();
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: spanOf(part).end,
      text: '#',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    // One bold run holding both, rather than the content rebuilt as plain text.
    expect(serializeOoxmlPart(next)).toContain('<w:b/>');
    expect(serializeOoxmlPart(next)).toMatch(/<w:b\/><\/w:rPr><w:t>MID<\/w:t><w:t>#<\/w:t>/);
  });

  test('the leading edge lands where it already landed', () => {
    const part = inline();
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: spanOf(part).start,
      text: '#',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    expect(contentControlTextOf(contentControlsIn(next.root)[0]!.node)).toBe('#MID');
  });

  test('an empty control gets a run to hold the text', () => {
    const part = parseDoc(
      `<w:p><w:r><w:t>abc</w:t></w:r>` +
        `<w:sdt><w:sdtPr><w:tag w:val="f"/></w:sdtPr><w:sdtContent/></w:sdt>` +
        `<w:r><w:t>xyz</w:t></w:r></w:p>`
    );
    const next = apply(part, {
      op: 'insertText',
      paragraphId: paragraphs(part)[0]!.id,
      offset: 3,
      text: 'FILLED',
      inside: contentControlsIn(part.root)[0]!.node.id,
    });
    expect(contentControlTextOf(contentControlsIn(next.root)[0]!.node)).toBe('FILLED');
  });

  test('a name no control carries is refused, not written somewhere else', () => {
    const part = inline();
    expect(
      refusal(part, {
        op: 'insertText',
        paragraphId: paragraphs(part)[0]!.id,
        offset: 3,
        text: '#',
        inside: 'no-such-node',
      })
    ).toBe('unknown-content-control');
  });
});
