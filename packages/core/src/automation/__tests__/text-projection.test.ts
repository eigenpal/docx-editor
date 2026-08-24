import { describe, expect, test } from 'bun:test';
import { WML_NAMESPACE_URI, type OoxmlParagraphNode } from '../../store/package/ooxml-tree.ts';
import { projectParagraphText } from '../text-projection.ts';

describe('projected text offset mapping', () => {
  test('maps valid ranges and refuses invalid ranges without targeting offset zero', () => {
    const paragraph: OoxmlParagraphNode = {
      id: 'paragraph',
      kind: 'paragraph',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'p',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [],
      children: [],
    };
    const projected = projectParagraphText(paragraph, 'alpha', 'allMarkup');

    expect(projected.rawRange(1, 4)).toEqual({ start: 1, end: 4 });
    expect(projected.rawRange(0, 0)).toBeNull();
    expect(projected.rawRange(-1, 1)).toBeNull();
    expect(projected.rawRange(0, 6)).toBeNull();
  });
});
