// Byte-exact paragraph-properties capsule extraction (document-engine 3.1/3.2/3.5). The capsule MUST
// be byte-identical to the source and MUST fail closed (null) on anything it cannot cleanly isolate,
// so it can never drop or corrupt authored OOXML.

import { describe, expect, test } from 'bun:test';
import { extractParagraphPropertiesCapsule, paragraphInnerWithCapsule, extractParagraphOpenAttributes, extractRunPropertiesCapsule, splitDirectRunSlices, isRunPropertiesCapsule } from '../package/preservation-capsule.ts';

describe('extractParagraphPropertiesCapsule', () => {
  test('captures a leading w:pPr verbatim (attribute order + whitespace preserved)', () => {
    const slice = '<w:p><w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="240" w:after="0"/></w:pPr><w:r><w:t>Hi</w:t></w:r></w:p>';
    expect(extractParagraphPropertiesCapsule(slice)).toBe('<w:pPr><w:pStyle w:val="Heading1"/><w:spacing w:before="240" w:after="0"/></w:pPr>');
  });

  test('captures a self-closing <w:pPr/>', () => {
    expect(extractParagraphPropertiesCapsule('<w:p><w:pPr/><w:r><w:t>x</w:t></w:r></w:p>')).toBe('<w:pPr/>');
  });

  test('preserves exact bytes including single quotes and unusual whitespace', () => {
    const slice = "<w:p w:rsidR='00AB'>\n  <w:pPr>\t<w:jc w:val='center'/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>";
    expect(extractParagraphPropertiesCapsule(slice)).toBe("<w:pPr>\t<w:jc w:val='center'/></w:pPr>");
  });

  test('handles > inside an attribute value in the w:pPr opening tag', () => {
    const slice = '<w:p><w:pPr w:x="a>b"><w:jc w:val="left"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>';
    expect(extractParagraphPropertiesCapsule(slice)).toBe('<w:pPr w:x="a>b"><w:jc w:val="left"/></w:pPr>');
  });

  test('finds the w:pPr even when the w:p opening tag has a > inside an attribute value (quote-aware)', () => {
    const slice = '<w:p x:value="a>b"><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>';
    expect(extractParagraphPropertiesCapsule(slice)).toBe('<w:pPr><w:jc w:val="center"/></w:pPr>');
  });

  test('returns null when there is no leading w:pPr', () => {
    expect(extractParagraphPropertiesCapsule('<w:p><w:r><w:t>x</w:t></w:r></w:p>')).toBeNull();
  });

  test('returns null for an empty self-closed paragraph', () => {
    expect(extractParagraphPropertiesCapsule('<w:p/>')).toBeNull();
  });

  test('fails closed on a comment before the properties (would be dropped)', () => {
    expect(extractParagraphPropertiesCapsule('<w:p><!-- c --><w:pPr/><w:r><w:t>x</w:t></w:r></w:p>')).toBeNull();
  });

  test('fails closed on a malformed / unterminated w:pPr', () => {
    expect(extractParagraphPropertiesCapsule('<w:p><w:pPr><w:jc w:val="left"/></w:p>')).toBeNull();
    expect(extractParagraphPropertiesCapsule('<w:p><w:pPr')).toBeNull();
  });

  test('does not mistake an element merely prefixed w:pPr', () => {
    expect(extractParagraphPropertiesCapsule('<w:p><w:pPrChange/><w:r><w:t>x</w:t></w:r></w:p>')).toBeNull();
  });

  test('balanced-matches a NESTED w:pPr (w:pPrChange) — captures the full outer, never truncates', () => {
    // w:pPrChange (a tracked paragraph-property change) contains a nested <w:pPr>; the first
    // </w:pPr> closes the INNER one, so naive matching would truncate + corrupt. Depth matching
    // captures the whole outer element.
    const full = '<w:pPr><w:pStyle w:val="H1"/><w:pPrChange w:id="1" w:author="X"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr>';
    expect(extractParagraphPropertiesCapsule(`<w:p>${full}<w:r><w:t>t</w:t></w:r></w:p>`)).toBe(full);
  });

  test('captures a w:pPr containing a comment verbatim', () => {
    const cap = '<w:pPr><!-- keep --><w:jc w:val="left"/></w:pPr>';
    expect(extractParagraphPropertiesCapsule(`<w:p>${cap}<w:r><w:t>t</w:t></w:r></w:p>`)).toBe(cap);
  });

  test('fails closed on a nested element left unclosed (full tag-stack balance, not just w:pPr depth)', () => {
    // w:pPrChange is never closed; naive w:pPr-depth matching would capture up to the inner
    // </w:pPr> and emit a malformed fragment. Full-stack balancing rejects it.
    expect(extractParagraphPropertiesCapsule('<w:p><w:pPr><w:pPrChange><w:pPr/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>')).toBeNull();
  });

  test('fails closed on a mismatched close tag', () => {
    expect(extractParagraphPropertiesCapsule('<w:p><w:pPr><w:jc w:val="l"></w:spacing></w:pPr><w:r/></w:p>')).toBeNull();
  });

  test('a comment or CDATA close-tag decoy inside w:pPr does not truncate capture', () => {
    const cap = '<w:pPr><w:jc w:val="l"/><!-- </w:pPr> decoy --></w:pPr>';
    expect(extractParagraphPropertiesCapsule(`<w:p>${cap}<w:r><w:t>x</w:t></w:r></w:p>`)).toBe(cap);
  });

  test('is byte-exact: re-extracting the captured capsule from a rebuilt paragraph is stable', () => {
    const capsule = '<w:pPr><w:jc w:val="right"/></w:pPr>';
    const inner = paragraphInnerWithCapsule(capsule, '<w:r><w:t>edited</w:t></w:r>');
    expect(extractParagraphPropertiesCapsule(`<w:p>${inner}</w:p>`)).toBe(capsule);
  });
});

describe('paragraphInnerWithCapsule', () => {
  test('reinserts the capsule before the runs (OOXML child order)', () => {
    expect(paragraphInnerWithCapsule('<w:pPr/>', '<w:r><w:t>x</w:t></w:r>')).toBe('<w:pPr/><w:r><w:t>x</w:t></w:r>');
  });
  test('emits only the runs when there is no capsule', () => {
    expect(paragraphInnerWithCapsule(undefined, '<w:r><w:t>x</w:t></w:r>')).toBe('<w:r><w:t>x</w:t></w:r>');
  });
});

describe('extractParagraphOpenAttributes', () => {
  test('captures the w:p opening attributes verbatim (leading whitespace preserved)', () => {
    expect(extractParagraphOpenAttributes('<w:p w:rsidR="00AB" w:rsidRDefault="00CD"><w:r><w:t>x</w:t></w:r></w:p>')).toBe(' w:rsidR="00AB" w:rsidRDefault="00CD"');
  });
  test("returns '' for a plain <w:p> (no attributes)", () => {
    expect(extractParagraphOpenAttributes('<w:p><w:r><w:t>x</w:t></w:r></w:p>')).toBe('');
  });
  test('captures attributes of a self-closing empty paragraph', () => {
    expect(extractParagraphOpenAttributes('<w:p w:rsidR="00AB"/>')).toBe(' w:rsidR="00AB"');
  });
  test('handles > inside an attribute value', () => {
    expect(extractParagraphOpenAttributes('<w:p w:x="a>b"><w:r/></w:p>')).toBe(' w:x="a>b"');
  });
  test('does not match w:pPr as the paragraph tag', () => {
    // A slice that does not begin with a w:p element has no paragraph opening tag.
    expect(extractParagraphOpenAttributes('<w:pPr/>')).toBeNull();
  });
})

describe('run-properties capsule', () => {
  test('extracts a leading w:rPr verbatim', () => {
    const run = '<w:r><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="24"/><w:color w:val="FF0000"/></w:rPr><w:t>x</w:t></w:r>';
    expect(extractRunPropertiesCapsule(run)).toBe('<w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="24"/><w:color w:val="FF0000"/></w:rPr>');
  });
  test('returns null for a run with no rPr, or a self-closing run', () => {
    expect(extractRunPropertiesCapsule('<w:r><w:t>x</w:t></w:r>')).toBeNull();
    expect(extractRunPropertiesCapsule('<w:r/>')).toBeNull();
  });
  test('balanced-matches a nested rPr (w:rPrChange contains a w:rPr)', () => {
    const cap = '<w:rPr><w:b/><w:rPrChange w:id="1"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr>';
    expect(extractRunPropertiesCapsule(`<w:r>${cap}<w:t>x</w:t></w:r>`)).toBe(cap);
  });
  test('splitDirectRunSlices splits direct runs, skipping a leading w:pPr + whitespace', () => {
    const inner = '<w:pPr><w:jc w:val="left"/></w:pPr> <w:r><w:t>a</w:t></w:r>\n<w:r><w:rPr><w:b/></w:rPr><w:t>b</w:t></w:r>';
    expect(splitDirectRunSlices(inner)).toEqual(['<w:r><w:t>a</w:t></w:r>', '<w:r><w:rPr><w:b/></w:rPr><w:t>b</w:t></w:r>']);
  });
  test('splitDirectRunSlices fails closed on a non-run child (hyperlink)', () => {
    expect(splitDirectRunSlices('<w:hyperlink><w:r><w:t>x</w:t></w:r></w:hyperlink>')).toBeNull();
  });
})

describe('isRunPropertiesCapsule (security: reject forged/malicious capsules)', () => {
  test('accepts exactly one balanced w:rPr', () => {
    expect(isRunPropertiesCapsule('<w:rPr><w:b/><w:color w:val="FF0000"/></w:rPr>')).toBe(true);
    expect(isRunPropertiesCapsule('<w:rPr/>')).toBe(true);
  });
  test('rejects anything that is not a lone w:rPr (injection defense)', () => {
    expect(isRunPropertiesCapsule('<w:rPr/><w:object>evil</w:object>')).toBe(false); // trailing element
    expect(isRunPropertiesCapsule('<w:object>evil</w:object>')).toBe(false); // wrong root
    expect(isRunPropertiesCapsule('<w:rPr><w:b/>')).toBe(false); // unbalanced
    expect(isRunPropertiesCapsule('not xml at all')).toBe(false);
    expect(isRunPropertiesCapsule('')).toBe(false);
  });
})
