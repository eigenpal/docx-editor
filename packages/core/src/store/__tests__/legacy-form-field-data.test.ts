// The bounded `w:ffData` reader: legacy form-field RENDER STATE only, macros never.
//
// Everything in ffData is attacker-controlled. The reader walks fldChar → ffData →
// checkBox/ddList → leaf attributes with a hard node budget, caps every collection before
// allocating, and fails closed to null so callers keep the presence-only behavior.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlNode, type OoxmlPart } from '../index.ts';
import { legacyFormFieldDataOf } from '../package/field-nodes.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const metadata = {
  name: '/word/document.xml',
  contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function partOf(body: string): OoxmlPart {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`,
    metadata
  );
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

/** Parse a run holding one begin `w:fldChar` and return that fldChar node. */
function fldCharOf(fldCharInner: string): OoxmlNode {
  const part = partOf(
    `<w:p><w:r><w:fldChar w:fldCharType="begin">${fldCharInner}</w:fldChar></w:r></w:p>`
  );
  const find = (node: OoxmlNode): OoxmlNode | undefined => {
    if (node.kind !== 'textValue' && node.localName === 'fldChar') return node;
    if (node.kind === 'textValue') return undefined;
    for (const child of node.children ?? []) {
      const hit = find(child);
      if (hit) return hit;
    }
    return undefined;
  };
  const fldChar = find(part.root);
  if (!fldChar) throw new Error('no fldChar');
  return fldChar;
}

function checkboxDataOf(checkBoxInner: string, ffDataExtra = '') {
  return legacyFormFieldDataOf(
    fldCharOf(`<w:ffData>${ffDataExtra}<w:checkBox>${checkBoxInner}</w:checkBox></w:ffData>`)
  );
}

function dropdownDataOf(ddListInner: string) {
  return legacyFormFieldDataOf(
    fldCharOf(`<w:ffData><w:ddList>${ddListInner}</w:ddList></w:ffData>`)
  );
}

describe('checkbox state', () => {
  test('w:checked on/off value forms', () => {
    expect(checkboxDataOf('<w:checked/>')).toMatchObject({ kind: 'checkbox', checked: true });
    expect(checkboxDataOf('<w:checked w:val="1"/>')).toMatchObject({ checked: true });
    expect(checkboxDataOf('<w:checked w:val="true"/>')).toMatchObject({ checked: true });
    expect(checkboxDataOf('<w:checked w:val="0"/>')).toMatchObject({ checked: false });
    expect(checkboxDataOf('<w:checked w:val="false"/>')).toMatchObject({ checked: false });
  });

  test('w:default is the fallback and w:checked wins over it', () => {
    expect(checkboxDataOf('<w:default w:val="1"/>')).toMatchObject({ checked: true });
    expect(checkboxDataOf('<w:default/>')).toMatchObject({ checked: true });
    expect(checkboxDataOf('<w:default w:val="0"/>')).toMatchObject({ checked: false });
    expect(checkboxDataOf('')).toMatchObject({ kind: 'checkbox', checked: false });
    expect(checkboxDataOf('<w:checked w:val="0"/><w:default w:val="1"/>')).toMatchObject({
      checked: false,
    });
  });

  test('explicit w:size is half-points, clamped to the render range', () => {
    expect(checkboxDataOf('<w:size w:val="24"/>')).toMatchObject({ sizeHalfPoints: 24 });
    expect(checkboxDataOf('<w:size w:val="1"/>')).toMatchObject({ sizeHalfPoints: 2 });
    expect(checkboxDataOf('<w:size w:val="999999"/>')).toMatchObject({ sizeHalfPoints: 288 });
    // Malformed size falls back to auto rather than failing the whole read.
    expect(checkboxDataOf('<w:size w:val="abc"/>')).toMatchObject({ sizeHalfPoints: null });
    expect(checkboxDataOf('<w:size/>')).toMatchObject({ sizeHalfPoints: null });
  });

  test('w:sizeAuto means auto even beside an explicit size', () => {
    expect(checkboxDataOf('<w:sizeAuto/>')).toMatchObject({ sizeHalfPoints: null });
    expect(checkboxDataOf('<w:size w:val="24"/><w:sizeAuto/>')).toMatchObject({
      sizeHalfPoints: null,
    });
  });
});

describe('dropdown state', () => {
  const entries =
    '<w:listEntry w:val="Red"/><w:listEntry w:val="Green"/><w:listEntry w:val="Blue"/>';

  test('result picks the entry; default is the fallback; both-out-of-range is 0', () => {
    expect(dropdownDataOf(`<w:result w:val="2"/>${entries}`)).toEqual({
      kind: 'dropdown',
      entries: ['Red', 'Green', 'Blue'],
      selectedIndex: 2,
    });
    expect(dropdownDataOf(`<w:result w:val="9"/><w:default w:val="1"/>${entries}`)).toMatchObject({
      selectedIndex: 1,
    });
    expect(dropdownDataOf(`<w:result w:val="9"/><w:default w:val="8"/>${entries}`)).toMatchObject({
      selectedIndex: 0,
    });
    expect(dropdownDataOf(entries)).toMatchObject({ selectedIndex: 0 });
  });

  test('indices clamp into [0, 63] before range resolution', () => {
    expect(dropdownDataOf(`<w:result w:val="-5"/>${entries}`)).toMatchObject({ selectedIndex: 0 });
    expect(dropdownDataOf(`<w:result w:val="70"/><w:default w:val="2"/>${entries}`)).toMatchObject({
      selectedIndex: 2,
    });
    expect(dropdownDataOf(`<w:result w:val="junk"/>${entries}`)).toMatchObject({
      selectedIndex: 0,
    });
  });

  test('an empty list still returns the dropdown shape', () => {
    expect(dropdownDataOf('<w:result w:val="1"/>')).toEqual({
      kind: 'dropdown',
      entries: [],
      selectedIndex: 0,
    });
  });

  test('a hostile entry count caps at 64 collected entries', () => {
    const flood = '<w:listEntry w:val="x"/>'.repeat(1000);
    const data = dropdownDataOf(flood);
    expect(data).not.toBeNull();
    if (data?.kind !== 'dropdown') throw new Error('expected dropdown');
    expect(data.entries.length).toBe(64);
  });

  test('a hostile entry length caps at 256 characters', () => {
    const long = 'a'.repeat(10_000);
    const data = dropdownDataOf(`<w:listEntry w:val="${long}"/>`);
    if (data?.kind !== 'dropdown') throw new Error('expected dropdown');
    expect(data.entries[0]!.length).toBe(256);
  });
});

describe('the security contract', () => {
  test('macro, name and behavior strings never surface in the result', () => {
    const data = checkboxDataOf(
      '<w:checked/>',
      '<w:name w:val="SecretFieldName"/>' +
        '<w:enabled/><w:calcOnExit w:val="1"/>' +
        '<w:entryMacro w:val="EvilEntryMacro"/>' +
        '<w:exitMacro w:val="EvilExitMacro"/>' +
        '<w:helpText w:type="text" w:val="EvilHelp"/>' +
        '<w:statusText w:type="text" w:val="EvilStatus"/>'
    );
    expect(data).toEqual({ kind: 'checkbox', checked: true, sizeHalfPoints: null });
    const serialized = JSON.stringify(data);
    for (const leak of [
      'SecretFieldName',
      'EvilEntryMacro',
      'EvilExitMacro',
      'EvilHelp',
      'EvilStatus',
      'enabled',
      'calcOnExit',
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  test('deep hostile nesting inside state elements is never descended into', () => {
    const data = checkboxDataOf(
      '<w:checked><w:entryMacro w:val="Nested"/><w:checked w:val="0"/></w:checked>'
    );
    expect(data).toEqual({ kind: 'checkbox', checked: true, sizeHalfPoints: null });
    expect(JSON.stringify(data)).not.toContain('Nested');
    // ffData nested one level too deep is not found either.
    const buried = legacyFormFieldDataOf(
      fldCharOf('<w:wrapper><w:ffData><w:checkBox><w:checked/></w:checkBox></w:ffData></w:wrapper>')
    );
    expect(buried).toBeNull();
  });

  test('no ffData, textInput-only ffData, and non-fldChar nodes all read as null', () => {
    expect(legacyFormFieldDataOf(fldCharOf(''))).toBeNull();
    expect(
      legacyFormFieldDataOf(
        fldCharOf('<w:ffData><w:textInput><w:default w:val="x"/></w:textInput></w:ffData>')
      )
    ).toBeNull();
    const part = partOf('<w:p><w:r><w:t>plain</w:t></w:r></w:p>');
    expect(legacyFormFieldDataOf(part.root)).toBeNull();
  });
});
