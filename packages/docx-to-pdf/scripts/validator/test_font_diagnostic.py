# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.dom import minidom

from catalog import triage, write_json
from evidence import digest
from font_diagnostic import A, W, PART, create_copy, metadata


class FontDiagnosticTests(unittest.TestCase):
    def fixture(self, root, extra=None):
        source = root / 'original.docx'
        with zipfile.ZipFile(source, 'w') as archive:
            archive.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
            archive.writestr('word/document.xml', f'''<w:document xmlns:w="{W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w14="urn:test" mc:Ignorable="w14"><w:body><w:p><w:r><w:rPr><w:rStyle w:val="Emphasis"/><w:rFonts w:asciiTheme="minorHAnsi"/><w:b/><w:sz w:val="24"/></w:rPr><w:t>Unchanged text</w:t></w:r></w:p></w:body></w:document>''')
            archive.writestr('word/styles.xml', f'<w:styles xmlns:w="{W}"><w:style w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Missing"/></w:rPr></w:style></w:styles>')
            archive.writestr('word/header1.xml', f'<w:hdr xmlns:w="{W}"><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>')
            archive.writestr('word/fontTable.xml', f'<w:fonts xmlns:w="{W}"><w:font w:name="Old"><w:embedRegular/></w:font></w:fonts>')
            archive.writestr('word/theme/theme1.xml', f'<a:theme xmlns:a="{A}"><a:latin typeface="Old"/><a:font script="Jpan" typeface="Old"/></a:theme>')
            archive.writestr('word/media/image.png', b'image bytes unchanged')
            for name, value in (extra or {}).items():
                archive.writestr(name, value)
        return source

    def test_copy_preserves_source_content_and_namespace_bindings(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = self.fixture(root); before = digest(source)
            result = create_copy(source, root, 'Arial')
            copy = Path(result['source'])
            self.assertEqual(digest(source), before)
            self.assertNotEqual(digest(copy), before)
            self.assertEqual(metadata(copy)['originalSha256'], before)
            self.assertEqual(create_copy(source, root, 'Arial')['sourceSha256'], result['sourceSha256'])
            with zipfile.ZipFile(copy) as archive:
                self.assertEqual(archive.read('word/media/image.png'), b'image bytes unchanged')
                with minidom.parseString(archive.read('word/document.xml')) as doc:
                    self.assertEqual(doc.documentElement.getAttribute('xmlns:w14'), 'urn:test')
                    self.assertEqual(doc.getElementsByTagNameNS(W, 't')[0].firstChild.data, 'Unchanged text')
                    props = doc.getElementsByTagNameNS(W, 'r')[0].getElementsByTagNameNS(W, 'rPr')[0]
                    self.assertEqual([node.localName for node in props.childNodes], ['rStyle', 'rFonts', 'b', 'sz'])
                    fonts = props.getElementsByTagNameNS(W, 'rFonts')[0]
                    self.assertFalse(fonts.hasAttributeNS(W, 'asciiTheme'))
                    self.assertTrue(all(fonts.getAttributeNS(W, slot) == 'Arial' for slot in ('ascii', 'hAnsi', 'eastAsia', 'cs')))
                with minidom.parseString(archive.read('word/styles.xml')) as doc:
                    self.assertEqual(doc.documentElement.firstChild.localName, 'docDefaults')
                with minidom.parseString(archive.read('word/header1.xml')) as doc:
                    self.assertEqual(len(doc.getElementsByTagNameNS(W, 'rFonts')), 2)
                self.assertNotIn(b'embedRegular', archive.read('word/fontTable.xml'))
                self.assertNotIn(b'typeface="Old"', archive.read('word/theme/theme1.xml'))
            with self.assertRaisesRegex(ValueError, 'original DOCX'):
                create_copy(copy, root, 'Other')

    def test_refuses_unsafe_xml_and_preserves_source(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for payload in ('<!DOCTYPE x [<!ENTITY x "expansion">]><x/>', '<!DOCTYPE x><x/>'.encode('utf-16')):
                source = self.fixture(root, {'word/unsafe.xml': payload}); before = digest(source)
                with self.assertRaisesRegex(ValueError, 'DTD/entity'):
                    create_copy(source, root, 'Arial')
                self.assertEqual(digest(source), before)
            self.assertEqual(list((root / 'diagnostics').iterdir()), [])

    def test_symbol_encodings_keep_their_font_and_are_disclosed(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.fixture(root, {'word/numbering.xml': f'<w:numbering xmlns:w="{W}"><w:abstractNum><w:lvl><w:lvlText w:val="&#xf0b7;"/><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl></w:abstractNum></w:numbering>'})
            result = create_copy(source, root, 'Arial')
            self.assertEqual(result['diagnostic']['preservedSymbolFamilies'], ['Symbol'])
            with zipfile.ZipFile(result['source']) as archive:
                with minidom.parseString(archive.read('word/numbering.xml')) as doc:
                    self.assertEqual(doc.getElementsByTagNameNS(W, 'rFonts')[0].getAttributeNS(W, 'ascii'), 'Symbol')
                    self.assertEqual(doc.getElementsByTagNameNS(W, 'lvlText')[0].getAttributeNS(W, 'val'), '\uf0b7')

    def test_original_triage_excludes_diagnostics_and_filters_reference(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for identity, diagnostic in [('a' * 64, None), ('b' * 64, {'kind': 'shared-font'})]:
                write_json(root / 'documents' / identity / 'document.json', dict(
                    id=identity, name=identity, status='exported', diagnostic=diagnostic,
                    comparisons={'reference-a--ours': dict(errorPercent=2),
                                 'reference-b--ours': dict(errorPercent=10)}))
            report = triage(root, pair='reference-a--ours')
            self.assertEqual(len(report['issues']), 1)
            self.assertEqual(report['excludedDiagnostics'], 1)
            self.assertEqual(report['issues'][0]['pair'], 'reference-a--ours')
            self.assertEqual(len(triage(root, include_diagnostics=True)['issues']), 4)
            self.assertEqual(triage(root, pair='missing')['issues'][0]['verdict'], 'unscored')


if __name__ == '__main__':
    unittest.main()
