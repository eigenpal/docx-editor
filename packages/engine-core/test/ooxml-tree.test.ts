import { describe, expect, test } from 'bun:test';
import * as engineCore from '../src/index.ts';
import {
  XML_NAMESPACE_URI,
  WML_NAMESPACE_URI,
  canonicalOoxmlFingerprint,
  ooxmlTreesEqual,
  readOoxmlPart,
  serializeOoxmlPart,
  type OoxmlElement,
  type OoxmlPart,
  type OoxmlTextElementNode,
} from '../src/index.ts';

const invariantApi = engineCore as typeof engineCore & {
  readonly validateOoxmlPart: (part: OoxmlPart) =>
    | { readonly ok: true }
    | {
        readonly ok: false;
        readonly issues: readonly { readonly code: string; readonly nodeId?: string }[];
      };
};

const metadata = {
  name: '/word/document.xml',
  contentType:
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
};

function parse(xml: string): OoxmlPart {
  const result = readOoxmlPart(xml, metadata);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result.part;
}

function collectIds(node: OoxmlElement): string[] {
  const ids = [node.id];
  for (const child of node.children) {
    ids.push(child.id);
    if (child.kind !== 'textValue') ids.push(...collectIds(child).slice(1));
  }
  return ids;
}

describe('canonical typed OOXML tree', () => {
  test('keeps known and unknown mixed children in source order with stable identities', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:extension">` +
        '<w:body><w:p><w:pPr/><w:r><w:rPr/><w:t>A</w:t><w:tab/><w:br/></w:r>' +
        '<x:widget x:data="007">payload</x:widget><w:r><w:t>B</w:t></w:r></w:p></w:body>' +
        '</w:document>'
    );

    expect(part.root.kind).toBe('document');
    const body = part.root.children[0] as OoxmlElement;
    const paragraph = body.children[0] as OoxmlElement;
    expect(paragraph.children.map((child) => child.kind)).toEqual([
      'paragraphProperties',
      'run',
      'generic',
      'run',
    ]);
    const firstRun = paragraph.children[1] as OoxmlElement;
    expect(firstRun.children.map((child) => child.kind)).toEqual([
      'runProperties',
      'text',
      'tab',
      'hardBreak',
    ]);

    const unknown = paragraph.children[2] as OoxmlElement;
    expect(unknown).toMatchObject({
      kind: 'generic',
      namespaceUri: 'urn:extension',
      localName: 'widget',
      prefix: 'x',
      attributes: [
        {
          namespaceUri: 'urn:extension',
          localName: 'data',
          prefix: 'x',
          value: '007',
        },
      ],
    });
    expect(new Set([part.root.id, body.id, paragraph.id, firstRun.id, unknown.id]).size).toBe(5);
    expect(Object.isFrozen(part.root)).toBe(true);
    expect(Object.isFrozen(paragraph.children)).toBe(true);
  });

  test('resolves inherited, default, and rebound namespace prefixes', () => {
    const part = parse(
      '<root xmlns="urn:outer" xmlns:a="urn:one">' +
        '<a:item/><scope xmlns="urn:inner" xmlns:a="urn:two"><item a:flag="yes"/></scope>' +
        '<a:item/></root>'
    );
    const first = part.root.children[0] as OoxmlElement;
    const scope = part.root.children[1] as OoxmlElement;
    const inner = scope.children[0] as OoxmlElement;
    const last = part.root.children[2] as OoxmlElement;

    expect([part.root.namespaceUri, first.namespaceUri, scope.namespaceUri, inner.namespaceUri]).toEqual([
      'urn:outer',
      'urn:one',
      'urn:inner',
      'urn:inner',
    ]);
    expect(inner.attributes[0]).toMatchObject({
      namespaceUri: 'urn:two',
      localName: 'flag',
      value: 'yes',
    });
    expect(last.namespaceUri).toBe('urn:one');
    expect(scope.namespaceBindings).toEqual([
      { prefix: '', namespaceUri: 'urn:inner' },
      { prefix: 'a', namespaceUri: 'urn:two' },
    ]);
  });

  test('rejects undeclared prefixes and duplicate expanded-name attributes', () => {
    expect(readOoxmlPart('<p:item/>', metadata)).toMatchObject({
      ok: false,
      reason: 'undeclared-prefix',
    });
    expect(
      readOoxmlPart('<x xmlns:a="urn:same" xmlns:b="urn:same" a:id="1" b:id="2"/>', metadata)
    ).toMatchObject({ ok: false, reason: 'duplicate-expanded-attribute' });
  });

  test('inherits trust-boundary DTD, entity, size, depth, and element limits', () => {
    expect(readOoxmlPart('<!DOCTYPE x><x/>', metadata)).toMatchObject({
      ok: false,
      reason: 'dtd-forbidden',
    });
    expect(readOoxmlPart('<x>&custom;</x>', metadata)).toMatchObject({
      ok: false,
      reason: 'entity-forbidden',
    });
    expect(readOoxmlPart('<x/>', metadata, { maxBytes: 2 })).toMatchObject({
      ok: false,
      reason: 'too-large',
    });
    expect(
      readOoxmlPart('<x><a/><b/></x>', metadata, { maxBytes: 100, maxElements: 2 })
    ).toMatchObject({ ok: false, reason: 'too-many-elements' });
    expect(readOoxmlPart('<x>'.repeat(258) + '</x>'.repeat(258), metadata)).toMatchObject({
      ok: false,
      reason: 'too-deep',
    });
  });
});

describe('post-edit OOXML tree invariants', () => {
  test('accepts equivalent normalized parses with identical initial identities', () => {
    const compact = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>A</w:t></w:r></w:p></w:body></w:document>`
    );
    const formatted = parse(
      `<x:document xmlns:x="${WML_NAMESPACE_URI}">\n<x:body><x:p>\n<x:r><x:t>A</x:t></x:r>\n</x:p></x:body>\n</x:document>`
    );

    expect(collectIds(formatted.root)).toEqual(collectIds(compact.root));
    expect(invariantApi.validateOoxmlPart(compact)).toEqual({ ok: true });
  });

  test('rejects duplicate IDs introduced by a copy-modified tree', () => {
    const part = parse('<r xmlns="urn:test"><a/><b/></r>');
    const first = part.root.children[0] as OoxmlElement;
    const second = part.root.children[1] as OoxmlElement;
    const malformed = {
      ...part,
      root: {
        ...part.root,
        children: [first, { ...second, id: first.id }],
      },
    } as OoxmlPart;

    expect(invariantApi.validateOoxmlPart(malformed)).toMatchObject({
      ok: false,
      issues: [{ code: 'duplicate-id', nodeId: first.id }],
    });
  });

  test('rejects malformed names, attributes, text, and known-node copies', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r><w:t>A</w:t></w:r></w:p></w:body></w:document>`
    );
    const body = part.root.children[0] as OoxmlElement;
    const paragraph = body.children[0] as OoxmlElement;
    const run = paragraph.children[0] as OoxmlElement;
    const text = run.children[0] as OoxmlElement;
    const malformedText = {
      ...text,
      localName: 'bad:name',
      attributes: [
        {
          kind: 'genericExtension',
          namespaceUri: '',
          localName: 'a',
          value: '1',
        },
        {
          kind: 'genericExtension',
          namespaceUri: '',
          localName: 'a',
          value: '2',
        },
      ],
      children: [{ ...text.children[0], value: '\u0000' }, { ...body }],
    };
    const malformed = {
      ...part,
      root: {
        ...part.root,
        children: [
          {
            ...body,
            children: [
              {
                ...paragraph,
                children: [{ ...run, children: [malformedText] }],
              },
            ],
          },
        ],
      },
    } as OoxmlPart;

    const result = invariantApi.validateOoxmlPart(malformed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'invalid-name',
        'duplicate-expanded-attribute',
        'invalid-xml-value',
        'known-node-invariant',
      ])
    );
  });
});

describe('reviewed namespace, identity, and typing invariants', () => {
  const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
  const XSI_NAMESPACE_URI = 'http://www.w3.org/2001/XMLSchema-instance';

  test('preserves QName-valued compatibility bindings through normalized save and reopen', () => {
    const source =
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:mc="${MC_NAMESPACE_URI}" ` +
      'xmlns:w14="urn:word14" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'mc:Ignorable="w14" mc:ProcessContent="w14:widget" ' +
      'mc:PreserveElements="w14:keep" mc:PreserveAttributes="w14:flag">' +
      '<w:body><w:p><w14:widget xsi:type="w14:Widget"/></w:p></w:body></w:document>';
    const part = parse(source);

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('xmlns:w14="urn:word14"');
    expect(saved).toContain('mc:Ignorable="ns1"');
    expect(saved).toContain('xsi:type="ns1:Widget"');

    const reopened = parse(saved);
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
  });

  test('canonicalizes known QName attribute values independently of prefix spelling', () => {
    const left = parse(
      `<r xmlns:mc="${MC_NAMESPACE_URI}" xmlns:xsi="${XSI_NAMESPACE_URI}" xmlns:a="urn:feature" ` +
        'mc:Ignorable="a" mc:ProcessContent="a:widget" mc:PreserveElements="a:keep" ' +
        'mc:PreserveAttributes="a:flag" xsi:type="a:Kind"/>'
    );
    const right = parse(
      `<r xmlns:q="urn:unused" xmlns:b="urn:feature" xmlns:xsi="${XSI_NAMESPACE_URI}" ` +
        `xmlns:m="${MC_NAMESPACE_URI}" xsi:type="b:Kind" m:PreserveAttributes="b:flag" ` +
        'm:PreserveElements="b:keep" m:ProcessContent="b:widget" m:Ignorable="b"/>'
    );

    expect(ooxmlTreesEqual(left, right)).toBe(true);
  });

  test('preserves nested prefix rebinding at the scope where it was authored', () => {
    const part = parse(
      '<a:root xmlns:a="urn:outer"><a:item/><scope xmlns:a="urn:inner">' +
        '<a:item xsi:type="a:Inner" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>' +
        '</scope><a:item/></a:root>'
    );

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('xmlns:a="urn:outer"');
    expect(saved).toContain('<scope xmlns:a="urn:inner">');
    expect(saved).not.toContain('<a:');
    expect(saved).toMatch(/xsi:type="ns\d+:Inner"/);
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });

  test('retains mixed-content whitespace when sibling character data makes it significant', () => {
    const withSpace = parse('<r xmlns="urn:mixed">a<i/> <b/>z</r>');
    const withoutSpace = parse('<r xmlns="urn:mixed">a<i/><b/>z</r>');

    expect(ooxmlTreesEqual(withSpace, withoutSpace)).toBe(false);
    const saved = serializeOoxmlPart(withSpace);
    expect(saved).toContain('a<');
    expect(saved).toContain('/> <');
    expect(ooxmlTreesEqual(withSpace, parse(saved))).toBe(true);
  });

  test('assigns structural IDs after insignificant whitespace canonicalization', () => {
    const compact = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p>` +
        '<w:r><w:t>A</w:t></w:r><w:r><w:t>B</w:t></w:r>' +
        '</w:p></w:body></w:document>'
    );
    const alternate = parse(
      `<x:document xmlns:x="${WML_NAMESPACE_URI}">\n  <x:body>\n    <x:p>\n` +
        '      <x:r><x:t>A</x:t></x:r>\n      <x:r><x:t>B</x:t></x:r>\n' +
        '    </x:p>\n  </x:body>\n</x:document>'
    );

    expect(collectIds(alternate.root)).toEqual(collectIds(compact.root));
    expect(collectIds(parse(serializeOoxmlPart(alternate)).root)).toEqual(
      collectIds(compact.root)
    );
  });

  test('classifies known names with invalid first-slice children as generic', () => {
    const invalidTab = parse(
      `<w:tab xmlns:w="${WML_NAMESPACE_URI}"><w:t>x</w:t></w:tab>`
    );
    const invalidText = parse(
      `<w:t xmlns:w="${WML_NAMESPACE_URI}"><w:br/></w:t>`
    );
    const invalidDocument = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:p/></w:document>`
    );

    expect(invalidTab.root.kind).toBe('generic');
    expect(invalidText.root.kind).toBe('generic');
    expect(invalidDocument.root.kind).toBe('generic');
  });
});

describe('round-two canonical namespace and typing behavior', () => {
  const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

  test('uses controlled prefixes for names while retaining authored aliases', () => {
    const part = parse(
      `<a:document xmlns:a="${WML_NAMESPACE_URI}" xmlns:e="urn:extension">` +
        '<a:body><a:p e:flag="yes"><e:item/></a:p></a:body></a:document>'
    );

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('<w:document');
    expect(saved).toContain('<ns1:item');
    expect(saved).toContain('ns1:flag="yes"');
    expect(saved).toContain(`xmlns:a="${WML_NAMESPACE_URI}"`);
    expect(saved).toContain('xmlns:e="urn:extension"');
    expect(saved).not.toContain('<a:document');
  });

  test('rewrites known QName values to controlled prefixes and preserves aliases', () => {
    const part = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${MC_NAMESPACE_URI}" ` +
        'xmlns:x="urn:feature" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" ' +
        'm:Ignorable="x"><w:body><w:p><x:item i:type="x:Kind"/></w:p></w:body></w:document>'
    );

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('mc:Ignorable="ns1"');
    expect(saved).toContain('xsi:type="ns1:Kind"');
    expect(saved).toContain('xmlns:x="urn:feature"');
    expect(saved).toContain(`xmlns:m="${MC_NAMESPACE_URI}"`);
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });

  test('canonicalizes mc Choice Requires prefix lists', () => {
    const left = parse(
      `<mc:Choice xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" Requires="a"/>`
    );
    const right = parse(
      `<m:Choice xmlns:m="${MC_NAMESPACE_URI}" xmlns:b="urn:feature" Requires="b"/>`
    );

    expect(ooxmlTreesEqual(left, right)).toBe(true);
    const saved = serializeOoxmlPart(left);
    expect(saved).toContain('<mc:Choice');
    expect(saved).toContain('Requires="ns1"');
    expect(saved).toContain('xmlns:a="urn:feature"');
  });

  test('canonicalizes mc MustUnderstand prefix lists', () => {
    const left = parse(
      `<r xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" mc:MustUnderstand="a"/>`
    );
    const right = parse(
      `<r xmlns:m="${MC_NAMESPACE_URI}" xmlns:b="urn:feature" m:MustUnderstand="b"/>`
    );

    expect(ooxmlTreesEqual(left, right)).toBe(true);
    const saved = serializeOoxmlPart(left);
    expect(saved).toContain('mc:MustUnderstand="ns1"');
    expect(saved).toContain('xmlns:a="urn:feature"');
    expect(
      readOoxmlPart(
        `<r xmlns:mc="${MC_NAMESPACE_URI}" mc:MustUnderstand="missing"/>`,
        metadata
      )
    ).toMatchObject({ ok: false, reason: 'undeclared-prefix' });
  });

  test('deduplicates supported MC prefix lists as namespace sets', () => {
    for (const localName of ['Ignorable', 'MustUnderstand']) {
      const single = parse(
        `<r xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" mc:${localName}="a"/>`
      );
      const duplicated = parse(
        `<r xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" mc:${localName}="a a"/>`
      );
      expect(canonicalOoxmlFingerprint(duplicated)).toBe(
        canonicalOoxmlFingerprint(single)
      );
      expect(serializeOoxmlPart(duplicated)).toBe(serializeOoxmlPart(single));
    }

    const choice = parse(
      `<mc:Choice xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" Requires="a"/>`
    );
    const duplicateChoice = parse(
      `<mc:Choice xmlns:mc="${MC_NAMESPACE_URI}" xmlns:a="urn:feature" Requires="a a"/>`
    );
    expect(canonicalOoxmlFingerprint(duplicateChoice)).toBe(
      canonicalOoxmlFingerprint(choice)
    );
    expect(serializeOoxmlPart(duplicateChoice)).toBe(serializeOoxmlPart(choice));
  });

  test('keeps nested authored aliases while controlled names survive rebinding', () => {
    const part = parse(
      '<a:root xmlns:a="urn:outer"><a:item/><scope xmlns:a="urn:inner">' +
        '<a:item xsi:type="a:Inner" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>' +
        '</scope><a:item/></a:root>'
    );

    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('xmlns:a="urn:outer"');
    expect(saved).toContain('<scope xmlns:a="urn:inner"');
    expect(saved).not.toContain('<a:');
    expect(saved).toMatch(/xsi:type="ns\d+:Inner"/);
    expect(ooxmlTreesEqual(part, parse(saved))).toBe(true);
  });

  test('rejects undeclared tokens in all explicitly known QName attributes', () => {
    expect(
      readOoxmlPart(
        `<mc:Choice xmlns:mc="${MC_NAMESPACE_URI}" Requires="missing"/>`,
        metadata
      )
    ).toMatchObject({ ok: false, reason: 'undeclared-prefix' });
    expect(
      readOoxmlPart(
        `<r xmlns:mc="${MC_NAMESPACE_URI}" mc:ProcessContent="missing:item"/>`,
        metadata
      )
    ).toMatchObject({ ok: false, reason: 'undeclared-prefix' });
  });

  test('merges adjacent text and CDATA before assigning structural IDs', () => {
    const split = parse('<r xmlns="urn:text">a<![CDATA[b]]>c</r>');
    const merged = parse('<r xmlns="urn:text">abc</r>');

    expect(split.root.children).toHaveLength(1);
    expect(split.root.children[0]).toMatchObject({ kind: 'textValue', value: 'abc' });
    expect(canonicalOoxmlFingerprint(split)).toBe(canonicalOoxmlFingerprint(merged));
    expect(collectIds(split.root)).toEqual(collectIds(merged.root));
    expect(collectIds(parse(serializeOoxmlPart(split)).root)).toEqual(collectIds(split.root));
  });

  test('keeps entity spelling inside CDATA literal through save and reopen', () => {
    const part = parse('<r xmlns="urn:text">a<![CDATA[&#0;]]>b</r>');

    expect(part.root.children).toHaveLength(1);
    expect(part.root.children[0]).toMatchObject({
      kind: 'textValue',
      value: 'a&#0;b',
    });
    const saved = serializeOoxmlPart(part);
    expect(saved).toContain('a&amp;#0;b');
    const reopened = parse(saved);
    expect(canonicalOoxmlFingerprint(reopened)).toBe(canonicalOoxmlFingerprint(part));
    expect(collectIds(reopened.root)).toEqual(collectIds(part.root));
  });

  test('keeps legal paragraph-mark run properties typed', () => {
    const part = parse(
      `<w:pPr xmlns:w="${WML_NAMESPACE_URI}"><w:rPr><w:b w:val="true"/></w:rPr></w:pPr>`
    );

    expect(part.root.kind).toBe('paragraphProperties');
    expect((part.root.children[0] as OoxmlElement).kind).toBe('runProperties');
  });

  test('discriminates modeled and extension attributes without widening known text nodes', () => {
    const part = parse(
      `<w:t xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:extension" ` +
        'xml:space="preserve" x:flag="yes"> text </w:t>'
    );
    const text = part.root as OoxmlTextElementNode;
    expect(text.kind).toBe('text');
    expect(text.attributes.map((attribute) => attribute.kind)).toEqual([
      'xmlSpace',
      'genericExtension',
    ]);

    const property = parse(
      `<w:b xmlns:w="${WML_NAMESPACE_URI}" w:val="true"/>`
    );
    expect(property.root.attributes[0]).toMatchObject({
      kind: 'wmlVal',
      value: 'true',
    });
    expect(
      readOoxmlPart(
        `<w:t xmlns:w="${WML_NAMESPACE_URI}" xml:space="sometimes">x</w:t>`,
        metadata
      )
    ).toMatchObject({ ok: true });
    const invalid = parse(
      `<w:t xmlns:w="${WML_NAMESPACE_URI}" xml:space="sometimes">x</w:t>`
    );
    expect(invalid.root.kind).toBe('generic');
  });
});

describe('normalized OOXML serialization and canonical oracle', () => {
  test('normalizes attribute order while preserving safe authored namespace bindings', () => {
    const left = parse(
      `<a:document xmlns:a="${WML_NAMESPACE_URI}" xmlns:e="urn:extension">` +
        '<a:body><a:p e:z="2" plain="&quot;&lt;&amp;" e:a="1"><e:item>safe &amp; sound</e:item></a:p></a:body>' +
        '</a:document>'
    );
    const right = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:q="urn:extension"><w:body>` +
        "<w:p q:a='1' plain='&quot;&lt;&amp;' q:z='2'>\n<q:item>safe &amp; sound</q:item>\n</w:p>" +
        '</w:body></w:document>'
    );

    expect(canonicalOoxmlFingerprint(left)).toBe(canonicalOoxmlFingerprint(right));
    expect(ooxmlTreesEqual(left, right)).toBe(true);
    expect(serializeOoxmlPart(left)).toContain(
      'plain="&quot;&lt;&amp;" ns1:a="1" ns1:z="2"'
    );
    expect(serializeOoxmlPart(left)).toContain('safe &amp; sound');
    expect(serializeOoxmlPart(left)).toContain(`xmlns:a="${WML_NAMESPACE_URI}"`);
    expect(serializeOoxmlPart(right)).toContain('xmlns:q="urn:extension"');
  });

  test('preserves significant text including xml:space whitespace', () => {
    const preserved = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        `<w:t xml:space="preserve">  </w:t><w:t>word</w:t>` +
        '</w:r></w:p></w:body></w:document>'
    );
    const changed = parse(
      `<w:document xmlns:w="${WML_NAMESPACE_URI}"><w:body><w:p><w:r>` +
        `<w:t xml:space="preserve"> </w:t><w:t>word</w:t>` +
        '</w:r></w:p></w:body></w:document>'
    );

    const run = ((preserved.root.children[0] as OoxmlElement).children[0] as OoxmlElement)
      .children[0] as OoxmlElement;
    const text = run.children[0] as OoxmlElement;
    expect(text.attributes[0]).toMatchObject({
      namespaceUri: XML_NAMESPACE_URI,
      localName: 'space',
      value: 'preserve',
    });
    expect((text.children[0] as { value: string }).value).toBe('  ');
    expect(ooxmlTreesEqual(preserved, changed)).toBe(false);
  });

  test('ignores insignificant inter-element whitespace and lexical empty-element spelling', () => {
    const compact = parse('<r xmlns="urn:test"><a/><b></b></r>');
    const spaced = parse("<x:r xmlns:x='urn:test'>\n  <x:a></x:a>\n  <x:b/>\n</x:r>");

    expect(ooxmlTreesEqual(compact, spaced)).toBe(true);
  });

  test('detects significant child order and text changes', () => {
    expect(
      ooxmlTreesEqual(
        parse('<r xmlns="urn:test"><a/><b/></r>'),
        parse('<r xmlns="urn:test"><b/><a/></r>')
      )
    ).toBe(false);
    expect(
      ooxmlTreesEqual(
        parse('<r xmlns="urn:test">alpha<a/></r>'),
        parse('<r xmlns="urn:test">beta<a/></r>')
      )
    ).toBe(false);
  });

  test('rejects malicious names, duplicate attributes, and invalid XML 1.0 values on save', () => {
    const part = parse('<r xmlns="urn:test" safe="yes"/>');
    const badName = {
      ...part,
      root: { ...part.root, localName: 'r><injected' },
    } as OoxmlPart;
    const duplicateAttribute = {
      ...part,
      root: {
        ...part.root,
        attributes: [...part.root.attributes, ...part.root.attributes],
      },
    } as OoxmlPart;
    const invalidValue = {
      ...part,
      root: {
        ...part.root,
        attributes: [{ ...part.root.attributes[0], value: 'bad\u0000value' }],
      },
    } as OoxmlPart;

    expect(() => serializeOoxmlPart(badName)).toThrow('invalid local name');
    expect(() => serializeOoxmlPart(duplicateAttribute)).toThrow('duplicate expanded attribute');
    expect(() => serializeOoxmlPart(invalidValue)).toThrow('XML 1.0');
  });
});
