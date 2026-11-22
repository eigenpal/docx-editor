// The default paragraph style rule every styles reader shares.

import { describe, expect, test } from 'bun:test';
import {
  defaultParagraphStyleCandidateOf,
  defaultParagraphStyleIdOf,
  isNormalStyleName,
  type DefaultParagraphStyleCandidate,
} from '../default-paragraph-style.ts';
import { readOoxmlPart, type OoxmlElement } from '../ooxml-tree.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const style = (
  styleId: string,
  name: string | undefined,
  options: { type?: string; isDefault?: boolean } = {}
): DefaultParagraphStyleCandidate => ({
  styleId,
  name,
  type: options.type ?? 'paragraph',
  isDefault: options.isDefault ?? false,
});

describe('defaultParagraphStyleIdOf', () => {
  test('the last paragraph style with w:default wins', () => {
    expect(
      defaultParagraphStyleIdOf([
        style('Normal', 'Normal', { isDefault: true }),
        style('Body', 'Body', { isDefault: true }),
      ])
    ).toBe('Body');
  });

  test('a later duplicate without the flag keeps the id as the default', () => {
    expect(
      defaultParagraphStyleIdOf([
        style('X', 'X', { isDefault: true }),
        style('X', 'X'),
        style('a', 'Normal'),
      ])
    ).toBe('X');
  });

  test('without a flag, the paragraph style named "Normal" is the default', () => {
    expect(defaultParagraphStyleIdOf([style('Body', 'Body'), style('a', 'Normal')])).toBe('a');
  });

  test('the name compares trimmed and case-folded, and the last such style wins', () => {
    expect(defaultParagraphStyleIdOf([style('a', 'normal')])).toBe('a');
    expect(defaultParagraphStyleIdOf([style('a', ' NORMAL ')])).toBe('a');
    expect(defaultParagraphStyleIdOf([style('a', 'Normal'), style('b', 'Normal')])).toBe('b');
    expect(defaultParagraphStyleIdOf([style('b', 'Normal'), style('a', 'Normal')])).toBe('a');
  });

  test('a later duplicate decides whether an id still carries the name', () => {
    expect(defaultParagraphStyleIdOf([style('a', 'Normal'), style('a', 'Body')])).toBeNull();
    expect(
      defaultParagraphStyleIdOf([style('a', 'Normal'), style('b', 'Normal'), style('a', 'Normal')])
    ).toBe('a');
  });

  test('the id alone, other types, and other names never count', () => {
    expect(defaultParagraphStyleIdOf([style('Normal', 'Body')])).toBeNull();
    expect(defaultParagraphStyleIdOf([style('Normal', undefined)])).toBeNull();
    expect(defaultParagraphStyleIdOf([style('a', 'Normal', { type: 'character' })])).toBeNull();
    expect(defaultParagraphStyleIdOf([style('a', 'Normal', { type: '' })])).toBeNull();
    expect(defaultParagraphStyleIdOf([style('a', 'Normal Indent')])).toBeNull();
    expect(
      defaultParagraphStyleIdOf([style('T', 'Normal', { type: 'table', isDefault: true })])
    ).toBeNull();
  });

  test('a style id layout rejects never counts', () => {
    const long = 'x'.repeat(129);
    for (const styleId of [long, '__proto__', 'bad\u0001id']) {
      expect(defaultParagraphStyleIdOf([style('a', 'Normal'), style(styleId, 'Normal')])).toBe('a');
      expect(defaultParagraphStyleIdOf([style(styleId, 'Body', { isDefault: true })])).toBeNull();
    }
  });

  test('a name longer than any reader keeps never counts', () => {
    expect(isNormalStyleName(`${' '.repeat(200)}Normal`)).toBe(false);
    expect(isNormalStyleName('Normal')).toBe(true);
  });
});

describe('defaultParagraphStyleCandidateOf', () => {
  const element = (xml: string): OoxmlElement => {
    const read = readOoxmlPart(`<w:styles xmlns:w="${W}">${xml}</w:styles>`, {
      name: '/word/styles.xml',
      contentType: 'application/xml',
    });
    if (!read.ok) throw new Error(read.reason);
    const child = read.part.root.children[0];
    if (!child || child.kind === 'textValue') throw new Error('no style element');
    return child;
  };

  test('reads the id, type, first name, and every on-spelling of w:default', () => {
    expect(
      defaultParagraphStyleCandidateOf(
        element(
          '<w:style w:type="paragraph" w:default="on" w:styleId="a">' +
            '<w:name w:val="Normal"/><w:name w:val="Other"/></w:style>'
        )
      )
    ).toEqual({ styleId: 'a', type: 'paragraph', name: 'Normal', isDefault: true });
    expect(defaultParagraphStyleCandidateOf(element('<w:style w:type="paragraph"/>'))).toBeNull();
  });
});
