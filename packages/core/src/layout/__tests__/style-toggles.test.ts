// ECMA-376 §17.7.3 toggle properties, through the layout style cascade.
//
// The rule is small and every clause of it is load-bearing, so it gets its own file: which
// elements are toggles at all, how one `basedOn` chain collapses to one level value, how the
// levels combine, and what an explicit `w:val="0"` does at each of them.

import { describe, expect, test } from 'bun:test';
import { readOoxmlPart, type OoxmlElement } from '@docx-editor.dev/core/store';
import {
  buildStyleCascadeTable,
  cascadeParagraphFormatting,
  cascadeRunProperties,
  cascadeTableFormatting,
  tableCellStyleFormatting,
} from '../style-cascade.ts';
import { resolveRunStyle } from '../run-style.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function loadStyles(body: string): OoxmlElement {
  const result = readOoxmlPart(`<w:styles xmlns:w="${W}">${body}</w:styles>`, {
    name: '/word/styles.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root;
}

function paragraphPPr(body: string) {
  const result = readOoxmlPart(`<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`, {
    name: '/word/document.xml',
    contentType: 'app/xml',
  });
  if (!result.ok) throw new Error(result.reason);
  return result.part.root.children[0]!.children[0]!.children.find(
    (child) => child.kind === 'paragraphProperties'
  );
}

const HEADING1_LAST =
  `<w:style w:type="paragraph" w:styleId="Heading1">` +
  `<w:name w:val="Heading 1"/><w:basedOn w:val="Normal"/>` +
  `<w:pPr><w:spacing w:before="360" w:after="200"/></w:pPr>` +
  `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:b/>` +
  `<w:color w:val="1B3A5C"/><w:sz w:val="36"/></w:rPr></w:style>`;

describe('toggle properties combine across the levels of the style hierarchy', () => {
  test('character style toggles use XOR while direct formatting stays absolute', () => {
    const styles =
      `<w:style w:type="paragraph" w:styleId="Heading">` +
      `<w:rPr><w:b/><w:i/><w:caps/><w:smallCaps/><w:strike/><w:vanish/>` +
      `</w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Cancel">` +
      `<w:rPr><w:b/><w:i/><w:caps/><w:smallCaps/><w:strike/><w:vanish/>` +
      `</w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="ExplicitlyOff">` +
      `<w:rPr><w:b w:val="0"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const inherited = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Heading"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    ).runProperties;
    const cancelled = resolveRunStyle(
      cascadeRunProperties(
        inherited,
        [{ localName: 'rStyle', attributes: { val: 'Cancel' } }],
        table
      )
    );
    expect(cancelled).toMatchObject({
      bold: false,
      italic: false,
      caps: false,
      smallCaps: false,
      strike: false,
      hidden: false,
    });

    // An explicit `w:val="0"` at a level SETS the toggle off; it does not toggle and it does
    // not fall through. LibreOffice resolves it the same way, and so did the base branch.
    const explicitlyOff = resolveRunStyle(
      cascadeRunProperties(
        inherited,
        [{ localName: 'rStyle', attributes: { val: 'ExplicitlyOff' } }],
        table
      )
    );
    expect(explicitlyOff.bold).toBe(false);

    const directOff = resolveRunStyle(
      cascadeRunProperties(
        inherited,
        [
          { localName: 'rStyle', attributes: { val: 'ExplicitlyOff' } },
          { localName: 'b', attributes: { val: '0' } },
        ],
        table
      )
    );
    expect(directOff.bold).toBe(false);
  });

  test('a basedOn chain contributes ONE value to the toggle XOR, not one per style', () => {
    // §17.7.3: "If multiple instances of the toggle property appear at the same level of the
    // style hierarchy, then the first value encountered by the following algorithm shall be
    // used ... Attempt to read the value in the style. If it does not exist and the style has
    // a basedOn element with a non-empty value, repeat step 1 using the style specified by the
    // basedOn element." The walk STOPS at the tip, so a style and its base that both say bold
    // are one true, not two that cancel. Word writes exactly this whenever an author re-ticks
    // bold on a style whose base is already bold.
    const styles =
      `<w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Heading"><w:basedOn w:val="Base"/>` +
      `<w:rPr><w:b/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const inherited = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Heading"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    ).runProperties;
    expect(resolveRunStyle(cascadeRunProperties(inherited, [], table)).bold).toBe(true);
  });

  test('hidden text stays hidden when a style and its base both set w:vanish', () => {
    // The same defect as the bold one, but this is the one that leaks: a `hidden: false` here
    // paints, selects and copies text Word does not display at all.
    const styles =
      `<w:style w:type="paragraph" w:styleId="Base"><w:rPr><w:vanish/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Secret"><w:basedOn w:val="Base"/>` +
      `<w:rPr><w:vanish/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const inherited = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Secret"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    ).runProperties;
    expect(resolveRunStyle(cascadeRunProperties(inherited, [], table)).hidden).toBe(true);
  });

  test('document defaults short-circuit the toggle XOR rather than joining it', () => {
    // §17.7.3: "If the value specified by the document defaults is true, the effective value
    // is true." A term in the XOR would let a paragraph style — or a character style on top of
    // it — turn the default back off.
    const styles =
      `<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults>` +
      `<w:style w:type="paragraph" w:styleId="Heading"><w:rPr><w:b/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Emphasis"><w:rPr><w:b/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const inherited = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Heading"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    ).runProperties;
    expect(resolveRunStyle(cascadeRunProperties(inherited, [], table)).bold).toBe(true);
    expect(
      resolveRunStyle(
        cascadeRunProperties(
          inherited,
          [{ localName: 'rStyle', attributes: { val: 'Emphasis' } }],
          table
        )
      ).bold
    ).toBe(true);
    // Direct formatting is still read first and still wins (§17.7.3, first bullet).
    expect(
      resolveRunStyle(
        cascadeRunProperties(inherited, [{ localName: 'b', attributes: { val: '0' } }], table)
      ).bold
    ).toBe(false);
  });

  test('w:dstrike is not a toggle property, so two levels do not cancel it', () => {
    // §17.7.3 enumerates the toggle properties and `w:dstrike` (§17.3.2.9) is not among them;
    // §17.3.2.9 uses the non-toggle wording instead. Word keeps the double strikethrough on.
    const styles =
      `<w:style w:type="paragraph" w:styleId="Heading"><w:rPr><w:dstrike/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="AlsoStruck"><w:rPr><w:dstrike/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const inherited = cascadeParagraphFormatting(
      table,
      paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Heading"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
    ).runProperties;
    expect(
      resolveRunStyle(
        cascadeRunProperties(
          inherited,
          [{ localName: 'rStyle', attributes: { val: 'AlsoStruck' } }],
          table
        )
      ).doubleStrike
    ).toBe(true);
  });

  test('duplicate toggles inside ONE w:rPr resolve last-wins and never cancel', () => {
    // `CT_RPr`'s `EG_RPrBase` is a repeatable choice, so both of these are schema-valid. Two
    // instances in one `w:rPr` are one level, not two, so they cannot toggle each other off.
    // Which one the level takes is the ordinary last-wins reading, and LibreOffice agrees:
    // `<w:b w:val="0"/><w:b/>` renders bold.
    const styles =
      `<w:style w:type="paragraph" w:styleId="Twice"><w:rPr><w:b/><w:b/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="OffThenOn">` +
      `<w:rPr><w:b w:val="0"/><w:b/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="OnThenOff">` +
      `<w:rPr><w:b/><w:b w:val="0"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const boldFor = (styleId: string) =>
      resolveRunStyle(
        cascadeRunProperties(
          cascadeParagraphFormatting(
            table,
            paragraphPPr(
              `<w:p><w:pPr><w:pStyle w:val="${styleId}"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
            )
          ).runProperties,
          [],
          table
        )
      ).bold;
    expect(boldFor('Twice')).toBe(true);
    expect(boldFor('OffThenOn')).toBe(true);
    expect(boldFor('OnThenOff')).toBe(false);
  });

  test('an explicit off at the tip of a level ends the basedOn walk AND sets the toggle off', () => {
    // §17.7.3's walk reads the value in the style and only recurses into `basedOn` when the
    // style DOES NOT state it. `Cancel` states false, so `Base`'s true is never read; and an
    // explicit false is a SET, not a term, so the paragraph's bold does not survive it.
    const styles =
      `<w:style w:type="paragraph" w:styleId="Heading"><w:rPr><w:b/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Base"><w:rPr><w:b/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Cancel"><w:basedOn w:val="Base"/>` +
      `<w:rPr><w:b w:val="0"/></w:rPr></w:style>` +
      `<w:style w:type="character" w:styleId="Silent"><w:basedOn w:val="Base"/>` +
      `<w:rPr><w:i/></w:rPr></w:style>` +
      `<w:style w:type="paragraph" w:styleId="Plain"><w:rPr><w:sz w:val="24"/></w:rPr></w:style>`;
    const table = buildStyleCascadeTable(loadStyles(styles));
    const boldWith = (pStyleId: string, rStyleId: string) =>
      resolveRunStyle(
        cascadeRunProperties(
          cascadeParagraphFormatting(
            table,
            paragraphPPr(
              `<w:p><w:pPr><w:pStyle w:val="${pStyleId}"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`
            )
          ).runProperties,
          [{ localName: 'rStyle', attributes: { val: rStyleId } }],
          table
        )
      ).bold;
    expect(boldWith('Heading', 'Cancel')).toBe(false);
    // `Silent` states nothing, so the walk DOES reach `Base` and reads its `on`: over a plain
    // paragraph that is bold, and over a bold paragraph it toggles back to regular.
    expect(boldWith('Plain', 'Silent')).toBe(true);
    expect(boldWith('Heading', 'Silent')).toBe(false);
    // The same `on` through `Cancel` would have been reached if a false did not stop the walk.
    expect(boldWith('Plain', 'Cancel')).toBe(false);
  });

  describe('a toggle level is tri-state: on reverses, off sets, absent falls through', () => {
    // §17.7.3 works its XOR through with true values only and never says what an explicit
    // `w:val="0"` at a level does. LibreOffice and the pre-cascade engine both resolve one as
    // an explicit OFF, and Word's authoring corroborates the split: a "not bold" character
    // style over a bold paragraph style is written `<w:b/>`, because the toggle is how you
    // cancel — which leaves `w:val="0"` meaning off and nothing else.
    //
    // These six cases are the whole model. `-` is a level that states nothing.
    const CASES: readonly {
      readonly name: string;
      readonly defaults?: string;
      readonly table?: string;
      readonly paragraph?: string;
      readonly character?: string;
      readonly bold: boolean;
    }[] = [
      { name: 'table on, paragraph on, character on', table: '', paragraph: '', character: '', bold: true }, // prettier-ignore
      { name: 'table on, paragraph on', table: '', paragraph: '', bold: false },
      { name: 'paragraph on, character on', paragraph: '', character: '', bold: false },
      { name: 'table on, paragraph off', table: '', paragraph: ' w:val="0"', bold: false },
      { name: 'table on, character off', table: '', character: ' w:val="0"', bold: false },
      { name: 'docDefaults on, character off', defaults: '', character: ' w:val="0"', bold: false },
      // The short circuit itself: a true document default outlasts any number of `on` levels.
      { name: 'docDefaults on, paragraph on', defaults: '', paragraph: '', bold: true },
      { name: 'docDefaults on, paragraph on, character on', defaults: '', paragraph: '', character: '', bold: true }, // prettier-ignore
      // An off clears the short circuit, and a stronger `on` then reverses the off.
      { name: 'docDefaults on, paragraph off', defaults: '', paragraph: ' w:val="0"', bold: false },
      { name: 'docDefaults on, paragraph off, character on', defaults: '', paragraph: ' w:val="0"', character: '', bold: true }, // prettier-ignore
      // The stage the paragraph cascade hands to the run cascade has to carry the off: the
      // character style here says nothing about bold, and the default must stay cancelled.
      { name: 'docDefaults on, paragraph off, character silent', defaults: '', paragraph: ' w:val="0"', character: null as never, bold: false }, // prettier-ignore
      // A weaker off does not veto a stronger on.
      { name: 'table off, paragraph on', table: ' w:val="0"', paragraph: '', bold: true },
      // Once an off has cleared the short circuit, the `on` levels above it go back to
      // reversing each other. Keeping the short circuit alive past an off would make this one
      // bold, which is the difference between "the defaults win" and "the defaults win until
      // something says otherwise".
      { name: 'docDefaults on, table off, paragraph on, character on', defaults: '', table: ' w:val="0"', paragraph: '', character: '', bold: false }, // prettier-ignore
    ];

    for (const testCase of CASES) {
      test(testCase.name, () => {
        const styles =
          (testCase.defaults === undefined
            ? ''
            : `<w:docDefaults><w:rPrDefault><w:rPr>` +
              `<w:b${testCase.defaults}/></w:rPr></w:rPrDefault></w:docDefaults>`) +
          `<w:style w:type="table" w:styleId="Tbl"><w:rPr>` +
          `${testCase.table === undefined ? '' : `<w:b${testCase.table}/>`}</w:rPr></w:style>` +
          `<w:style w:type="paragraph" w:styleId="Para"><w:rPr>` +
          `${testCase.paragraph === undefined ? '' : `<w:b${testCase.paragraph}/>`}` +
          `</w:rPr></w:style>` +
          // The character style always exists, so the run cascade always runs its combination
          // — a `null` marker means it is present but silent about bold.
          `<w:style w:type="character" w:styleId="Chr"><w:rPr><w:sz w:val="24"/>` +
          `${testCase.character === undefined || testCase.character === null ? '' : `<w:b${testCase.character}/>`}` +
          `</w:rPr></w:style>`;
        const table = buildStyleCascadeTable(loadStyles(styles));
        const cellStyle = tableCellStyleFormatting(cascadeTableFormatting(table, 'Tbl'), []);
        const inherited = cascadeParagraphFormatting(
          table,
          paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Para"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`),
          cellStyle
        ).runProperties;
        const resolved = resolveRunStyle(
          cascadeRunProperties(
            inherited,
            [{ localName: 'rStyle', attributes: { val: 'Chr' } }],
            table
          )
        );
        expect(resolved.bold).toBe(testCase.bold);
      });
    }

    test('a list built by hand carries the off in the property list itself', () => {
      // `list-resolve.ts` resolves a numbering marker from `markRunProperties`, which is
      // `runProperties` plus the paragraph mark's own `w:rPr` — a NEW array, so it arrives
      // with no carried state and the combination has only the properties to read. That is
      // why the resolved value is written explicitly: without the `<w:b w:val="0"/>` the
      // paragraph style's off is indistinguishable from silence, and the document defaults'
      // short circuit puts the bold back on the marker alone.
      const styles =
        `<w:docDefaults><w:rPrDefault><w:rPr><w:b/></w:rPr></w:rPrDefault></w:docDefaults>` +
        `<w:style w:type="paragraph" w:styleId="Para">` +
        `<w:rPr><w:b w:val="0"/></w:rPr></w:style>` +
        `<w:style w:type="character" w:styleId="Chr"><w:rPr><w:sz w:val="24"/></w:rPr></w:style>`;
      const table = buildStyleCascadeTable(loadStyles(styles));
      const cascaded = cascadeParagraphFormatting(
        table,
        paragraphPPr(
          `<w:p><w:pPr><w:pStyle w:val="Para"/><w:rPr><w:i/></w:rPr></w:pPr>` +
            `<w:r><w:t>x</w:t></w:r></w:p>`
        )
      );
      // The mark cascade really is a separate array, or this test proves nothing.
      expect(cascaded.markRunProperties).not.toBe(cascaded.runProperties);
      const marker = resolveRunStyle(
        cascadeRunProperties(
          cascaded.markRunProperties,
          [{ localName: 'rStyle', attributes: { val: 'Chr' } }],
          table
        )
      );
      expect(marker.bold).toBe(false);
      expect(marker.italic).toBe(true);
    });

    test('an explicit off un-hides text a weaker level hid with w:vanish', () => {
      // The worst shape of the defect: text Word DISPLAYS must not be dropped from paint,
      // measurement and the clipboard.
      const styles =
        `<w:style w:type="paragraph" w:styleId="Secret"><w:rPr><w:vanish/></w:rPr></w:style>` +
        `<w:style w:type="character" w:styleId="Shown">` +
        `<w:rPr><w:vanish w:val="0"/></w:rPr></w:style>`;
      const table = buildStyleCascadeTable(loadStyles(styles));
      const inherited = cascadeParagraphFormatting(
        table,
        paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Secret"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
      ).runProperties;
      expect(resolveRunStyle(cascadeRunProperties(inherited, [], table)).hidden).toBe(true);
      expect(
        resolveRunStyle(
          cascadeRunProperties(
            inherited,
            [{ localName: 'rStyle', attributes: { val: 'Shown' } }],
            table
          )
        ).hidden
      ).toBe(false);
    });

    test('bCs and iCs are toggles, even though no lane reads them yet', () => {
      // Nothing resolves the complex-script pair into `ResolvedRunStyle`, so this asserts on
      // the cascade's own output. Without them in the enumeration they resolve by last-wins
      // and two `on` levels would come back on.
      const styles =
        `<w:style w:type="paragraph" w:styleId="Para">` +
        `<w:rPr><w:bCs/><w:iCs/></w:rPr></w:style>` +
        `<w:style w:type="character" w:styleId="Chr">` +
        `<w:rPr><w:bCs/><w:iCs w:val="0"/></w:rPr></w:style>`;
      const table = buildStyleCascadeTable(loadStyles(styles));
      const inherited = cascadeParagraphFormatting(
        table,
        paragraphPPr(`<w:p><w:pPr><w:pStyle w:val="Para"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)
      ).runProperties;
      const combined = cascadeRunProperties(
        inherited,
        [{ localName: 'rStyle', attributes: { val: 'Chr' } }],
        table
      );
      const valueOf = (localName: string) => {
        const found = combined.filter((property) => property.localName === localName);
        expect(found).toHaveLength(1);
        return found[0]!.attributes?.val;
      };
      // Two `on` levels reverse each other; the explicit off sets `iCs` off outright.
      expect(valueOf('bCs')).toBe('0');
      expect(valueOf('iCs')).toBe('0');
      // And one `on` level alone stays on, so the pair is not simply always off.
      expect(
        cascadeRunProperties(inherited, [], table).filter(
          (property) => property.localName === 'bCs'
        )
      ).toEqual([{ localName: 'bCs' }]);
    });
  });
});
